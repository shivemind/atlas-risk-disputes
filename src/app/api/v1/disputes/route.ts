import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { emitDomainEvent } from "@/lib/events";
import { prisma } from "@/lib/prisma";

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

const createSchema = z.object({
  payment_intent_id: z.string().min(1),
  reason: z.enum([
    "fraudulent",
    "duplicate",
    "not_received",
    "product_unacceptable",
    "subscription_canceled",
    "other",
  ]),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  due_by: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createSchema,
  handler: async (ctx) => {
    const dispute = await prisma.$transaction(async (tx) => {
      const pi = await tx.paymentIntent.findFirst({
        where: { id: ctx.body.payment_intent_id, merchantId: ctx.merchantId },
      });
      if (!pi) {
        throw new NotFoundError(
          "PAYMENT_INTENT_NOT_FOUND",
          "Payment intent not found.",
        );
      }

      const created = await tx.dispute.create({
        data: {
          merchantId: ctx.merchantId,
          paymentIntentId: pi.id,
          reason: ctx.body.reason.toUpperCase() as
            | "FRAUDULENT"
            | "DUPLICATE"
            | "NOT_RECEIVED"
            | "PRODUCT_UNACCEPTABLE"
            | "SUBSCRIPTION_CANCELED"
            | "OTHER",
          amount: ctx.body.amount,
          currency: ctx.body.currency,
          dueBy: ctx.body.due_by ? new Date(ctx.body.due_by) : null,
          metadata: ctx.body.metadata ?? {},
          status: "NEEDS_RESPONSE",
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "dispute.created",
        entityType: "Dispute",
        entityId: created.id,
        payload: serializeDispute(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { dispute: serializeDispute(dispute) },
      { status: 201 },
    );
  },
});

const listQuery = paginationSchema.extend({
  status: z
    .enum([
      "needs_response",
      "under_review",
      "won",
      "lost",
      "accepted",
      "expired",
    ])
    .optional(),
  payment_intent_id: z.string().optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuery,
  handler: async (ctx) => {
    const where: Record<string, unknown> = { merchantId: ctx.merchantId };
    if (ctx.query.status) where.status = ctx.query.status.toUpperCase();
    if (ctx.query.payment_intent_id)
      where.paymentIntentId = ctx.query.payment_intent_id;

    const skip = paginationSkip(ctx.query);
    const [total, disputes] = await Promise.all([
      prisma.dispute.count({ where }),
      prisma.dispute.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: disputes.map(serializeDispute),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
