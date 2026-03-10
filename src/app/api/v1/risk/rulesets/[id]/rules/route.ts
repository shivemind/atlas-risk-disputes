import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "@/lib/handler";
import { NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskRule(r: {
  id: string;
  rulesetId: string;
  name: string;
  description: string | null;
  condition: unknown;
  action: string;
  priority: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    ruleset_id: r.rulesetId,
    name: r.name,
    description: r.description,
    condition: r.condition,
    action: r.action.toLowerCase(),
    priority: r.priority,
    is_active: r.isActive,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

const createRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  condition: z.record(z.string(), z.unknown()),
  action: z.enum(["allow", "block", "review", "challenge"]),
  priority: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createRuleSchema,
  handler: async (ctx) => {
    const rule = await prisma.$transaction(async (tx) => {
      const ruleset = await tx.riskRuleset.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!ruleset) {
        throw new NotFoundError("RULESET_NOT_FOUND", "Risk ruleset not found.");
      }

      const created = await tx.riskRule.create({
        data: {
          rulesetId: ruleset.id,
          name: ctx.body.name,
          description: ctx.body.description,
          condition: ctx.body.condition as Prisma.InputJsonValue,
          action: ctx.body.action.toUpperCase() as "ALLOW" | "BLOCK" | "REVIEW" | "CHALLENGE",
          priority: ctx.body.priority,
          isActive: ctx.body.is_active,
        },
      });

      await tx.riskRuleset.update({
        where: { id: ruleset.id },
        data: { version: { increment: 1 } },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_rule.created",
        entityType: "RiskRule",
        entityId: created.id,
        payload: serializeRiskRule(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { risk_rule: serializeRiskRule(rule) },
      { status: 201 },
    );
  },
});

export const GET = createHandler({
  auth: "merchant",
  query: paginationSchema,
  handler: async (ctx) => {
    const ruleset = await prisma.riskRuleset.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!ruleset) {
      throw new NotFoundError("RULESET_NOT_FOUND", "Risk ruleset not found.");
    }

    const where: Prisma.RiskRuleWhereInput = { rulesetId: ruleset.id };
    const skip = paginationSkip(ctx.query);
    const [total, rules] = await Promise.all([
      prisma.riskRule.count({ where }),
      prisma.riskRule.findMany({
        where,
        orderBy: { priority: "asc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: rules.map(serializeRiskRule),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
