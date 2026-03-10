import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "@/lib/handler";
import { NotFoundError, ConflictError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskListEntry(e: {
  id: string;
  listId: string;
  value: string;
  valueType: string;
  reason: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: e.id,
    list_id: e.listId,
    value: e.value,
    value_type: e.valueType,
    reason: e.reason,
    expires_at: e.expiresAt?.toISOString() ?? null,
    created_at: e.createdAt.toISOString(),
  };
}

const createEntrySchema = z.object({
  value: z.string().min(1).max(500),
  value_type: z.string().min(1).max(100),
  reason: z.string().max(2000).optional(),
  expires_at: z.string().datetime().optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createEntrySchema,
  handler: async (ctx) => {
    const entry = await prisma.$transaction(async (tx) => {
      const list = await tx.riskList.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!list) {
        throw new NotFoundError("LIST_NOT_FOUND", "Risk list not found.");
      }

      const duplicate = await tx.riskListEntry.findUnique({
        where: {
          listId_valueType_value: {
            listId: list.id,
            valueType: ctx.body.value_type,
            value: ctx.body.value,
          },
        },
      });
      if (duplicate) {
        throw new ConflictError(
          "ENTRY_ALREADY_EXISTS",
          "An entry with this value and value_type already exists in this list.",
        );
      }

      const created = await tx.riskListEntry.create({
        data: {
          listId: list.id,
          value: ctx.body.value,
          valueType: ctx.body.value_type,
          reason: ctx.body.reason,
          expiresAt: ctx.body.expires_at ? new Date(ctx.body.expires_at) : undefined,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_list_entry.created",
        entityType: "RiskListEntry",
        entityId: created.id,
        payload: {
          ...serializeRiskListEntry(created),
          risk_list_id: list.id,
        } as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { risk_list_entry: serializeRiskListEntry(entry) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  value_type: z.string().optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const list = await prisma.riskList.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!list) {
      throw new NotFoundError("LIST_NOT_FOUND", "Risk list not found.");
    }

    const where: Prisma.RiskListEntryWhereInput = { listId: list.id };
    if (ctx.query.value_type) where.valueType = ctx.query.value_type;

    const skip = paginationSkip(ctx.query);
    const [total, entries] = await Promise.all([
      prisma.riskListEntry.count({ where }),
      prisma.riskListEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: entries.map(serializeRiskListEntry),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
