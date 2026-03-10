import { NextResponse } from "next/server";

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

function serializeRepresentment(r: {
  id: string;
  disputeId: string;
  submittedAt: Date | null;
  outcome: string | null;
  details: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    dispute_id: r.disputeId,
    submitted_at: r.submittedAt?.toISOString() ?? null,
    outcome: r.outcome,
    details: r.details,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

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

export const POST = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const result = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!dispute) {
        throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
      }

      const representment = await tx.representment.findUnique({
        where: { disputeId: dispute.id },
      });
      if (!representment) {
        throw new NotFoundError(
          "REPRESENTMENT_NOT_FOUND",
          "Representment not found. Create one first.",
        );
      }
      if (representment.submittedAt) {
        throw new ConflictError(
          "REPRESENTMENT_ALREADY_SUBMITTED",
          "Representment has already been submitted.",
        );
      }

      disputeMachine.assertTransition(
        dispute.status as DisputeStatus,
        "UNDER_REVIEW",
      );

      const now = new Date();
      const updatedRepresentment = await tx.representment.update({
        where: { id: representment.id },
        data: { submittedAt: now },
      });

      const updatedDispute = await tx.dispute.update({
        where: { id: dispute.id },
        data: { status: "UNDER_REVIEW" },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "dispute.representment.submitted",
        entityType: "Representment",
        entityId: representment.id,
        payload: serializeRepresentment(updatedRepresentment) as Record<
          string,
          unknown
        >,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return { dispute: updatedDispute, representment: updatedRepresentment };
    });

    return NextResponse.json({
      dispute: serializeDispute(result.dispute),
      representment: serializeRepresentment(result.representment),
    });
  },
});
