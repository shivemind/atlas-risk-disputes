import { NextResponse } from "next/server";
import { z } from "zod";

import { createHandler } from "@/lib/handler";
import { NotFoundError, ConflictError } from "@/lib/errors";
import { emitDomainEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { defineTransitions } from "@/lib/state-machine";

type DisputeStatus =
  | "NEEDS_RESPONSE"
  | "UNDER_REVIEW"
  | "WON"
  | "LOST"
  | "ACCEPTED"
  | "EXPIRED";

const disputeMachine = defineTransitions<DisputeStatus>({
  NEEDS_RESPONSE: ["UNDER_REVIEW", "ACCEPTED", "EXPIRED"],
  UNDER_REVIEW: ["WON", "LOST"],
});

function serializeDispute(d: {
  id: string;
  merchantId: string;
  paymentIntentId: string;
  status: string;
  reason: string;
  amount: number;
  currency: string;
  dueBy: Date | null;
  closedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: d.id,
    merchant_id: d.merchantId,
    payment_intent_id: d.paymentIntentId,
    status: d.status.toLowerCase(),
    reason: d.reason.toLowerCase(),
    amount: d.amount,
    currency: d.currency,
    due_by: d.dueBy?.toISOString() ?? null,
    closed_at: d.closedAt?.toISOString() ?? null,
    metadata: d.metadata,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const dispute = await prisma.dispute.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!dispute) {
      throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
    }
    return NextResponse.json({ dispute: serializeDispute(dispute) });
  },
});

const updateSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
  due_by: z.string().datetime().optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateSchema,
  handler: async (ctx) => {
    const updated = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!dispute) {
        throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
      }
      if (disputeMachine.isTerminal(dispute.status as DisputeStatus)) {
        throw new ConflictError(
          "DISPUTE_CLOSED",
          "Cannot update a closed dispute.",
        );
      }

      const data: Record<string, unknown> = {};
      if (ctx.body.metadata !== undefined) data.metadata = ctx.body.metadata;
      if (ctx.body.due_by !== undefined) data.dueBy = new Date(ctx.body.due_by);

      const result = await tx.dispute.update({
        where: { id: dispute.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "dispute.updated",
        entityType: "Dispute",
        entityId: result.id,
        payload: serializeDispute(result) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return result;
    });

    return NextResponse.json({ dispute: serializeDispute(updated) });
  },
});
