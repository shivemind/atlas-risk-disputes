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

function serializeRiskRuleset(r: {
  id: string;
  merchantId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    merchant_id: r.merchantId,
    name: r.name,
    description: r.description,
    is_active: r.isActive,
    version: r.version,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

const createRulesetSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  is_active: z.boolean().default(true),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createRulesetSchema,
  handler: async (ctx) => {
    const existing = await prisma.riskRuleset.findUnique({
      where: {
        merchantId_name: { merchantId: ctx.merchantId, name: ctx.body.name },
      },
    });
    if (existing) {
      throw new ConflictError(
        "RULESET_NAME_TAKEN",
        "A ruleset with this name already exists.",
      );
    }

    const ruleset = await prisma.$transaction(async (tx) => {
      const created = await tx.riskRuleset.create({
        data: {
          merchantId: ctx.merchantId,
          name: ctx.body.name,
          description: ctx.body.description,
          isActive: ctx.body.is_active,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_ruleset.created",
        entityType: "RiskRuleset",
        entityId: created.id,
        payload: serializeRiskRuleset(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { risk_ruleset: serializeRiskRuleset(ruleset) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  is_active: z.enum(["true", "false"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.RiskRulesetWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.is_active !== undefined) {
      where.isActive = ctx.query.is_active === "true";
    }

    const skip = paginationSkip(ctx.query);
    const [total, rulesets] = await Promise.all([
      prisma.riskRuleset.count({ where }),
      prisma.riskRuleset.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: rulesets.map(serializeRiskRuleset),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
