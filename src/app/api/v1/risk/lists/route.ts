import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "@/lib/handler";
import { ConflictError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskList(l: {
  id: string;
  merchantId: string;
  name: string;
  type: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: l.id,
    merchant_id: l.merchantId,
    name: l.name,
    type: l.type.toLowerCase(),
    description: l.description,
    is_active: l.isActive,
    created_at: l.createdAt.toISOString(),
    updated_at: l.updatedAt.toISOString(),
  };
}

const createListSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["allowlist", "blocklist"]),
  description: z.string().max(2000).optional(),
  is_active: z.boolean().default(true),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createListSchema,
  handler: async (ctx) => {
    const existing = await prisma.riskList.findUnique({
      where: {
        merchantId_name: { merchantId: ctx.merchantId, name: ctx.body.name },
      },
    });
    if (existing) {
      throw new ConflictError(
        "LIST_NAME_TAKEN",
        "A risk list with this name already exists.",
      );
    }

    const list = await prisma.$transaction(async (tx) => {
      const created = await tx.riskList.create({
        data: {
          merchantId: ctx.merchantId,
          name: ctx.body.name,
          type: ctx.body.type.toUpperCase() as "ALLOWLIST" | "BLOCKLIST",
          description: ctx.body.description,
          isActive: ctx.body.is_active,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_list.created",
        entityType: "RiskList",
        entityId: created.id,
        payload: serializeRiskList(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { risk_list: serializeRiskList(list) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  type: z.enum(["allowlist", "blocklist"]).optional(),
  is_active: z.enum(["true", "false"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.RiskListWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.type) {
      where.type = ctx.query.type.toUpperCase() as Prisma.EnumRiskListTypeFilter["equals"];
    }
    if (ctx.query.is_active !== undefined) {
      where.isActive = ctx.query.is_active === "true";
    }

    const skip = paginationSkip(ctx.query);
    const [total, lists] = await Promise.all([
      prisma.riskList.count({ where }),
      prisma.riskList.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: lists.map(serializeRiskList),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
