import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
} from "@/lib/handler";
import { NotFoundError, ConflictError } from "@/lib/errors";
import { emitDomainEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

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

const createSchema = z.object({
  details: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createSchema,
  handler: async (ctx) => {
    const representment = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!dispute) {
        throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
      }

      const existing = await tx.representment.findUnique({
        where: { disputeId: dispute.id },
      });
      if (existing) {
        throw new ConflictError(
          "REPRESENTMENT_EXISTS",
          "A representment already exists for this dispute.",
        );
      }

      if (dispute.status !== "NEEDS_RESPONSE" && dispute.status !== "UNDER_REVIEW") {
        throw new ConflictError(
          "DISPUTE_CLOSED",
          "Cannot create representment for a closed dispute.",
        );
      }

      const created = await tx.representment.create({
        data: {
          disputeId: dispute.id,
          details: ctx.body.details ?? {},
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "dispute.representment.created",
        entityType: "Representment",
        entityId: created.id,
        payload: serializeRepresentment(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { representment: serializeRepresentment(representment) },
      { status: 201 },
    );
  },
});

export const GET = createHandler({
  auth: "merchant",
  query: paginationSchema,
  handler: async (ctx) => {
    const dispute = await prisma.dispute.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!dispute) {
      throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
    }

    const representment = await prisma.representment.findUnique({
      where: { disputeId: dispute.id },
    });

    const data = representment ? [serializeRepresentment(representment)] : [];

    return NextResponse.json({
      data,
      pagination: paginationMeta(ctx.query, data.length),
    });
  },
});
