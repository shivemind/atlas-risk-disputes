import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "@/lib/handler";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events";

function serializeRiskDecision(d: {
  id: string;
  merchantId: string;
  entityType: string;
  entityId: string;
  outcome: string;
  riskScore: number | null;
  rulesetId: string | null;
  ruleId: string | null;
  reason: string | null;
  overriddenBy: string | null;
  overriddenAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: d.id,
    merchant_id: d.merchantId,
    entity_type: d.entityType,
    entity_id: d.entityId,
    outcome: d.outcome.toLowerCase(),
    risk_score: d.riskScore,
    ruleset_id: d.rulesetId,
    rule_id: d.ruleId,
    reason: d.reason,
    overridden_by: d.overriddenBy,
    overridden_at: d.overriddenAt?.toISOString() ?? null,
    metadata: d.metadata,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
  };
}

const createDecisionSchema = z.object({
  entity_type: z.string().min(1).max(100),
  entity_id: z.string().min(1).max(200),
  outcome: z.enum(["allow", "block", "review", "challenge"]),
  risk_score: z.number().int().min(0).max(1000).optional(),
  ruleset_id: z.string().optional(),
  rule_id: z.string().optional(),
  reason: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createDecisionSchema,
  handler: async (ctx) => {
    const decision = await prisma.$transaction(async (tx) => {
      const created = await tx.riskDecision.create({
        data: {
          merchantId: ctx.merchantId,
          entityType: ctx.body.entity_type,
          entityId: ctx.body.entity_id,
          outcome: ctx.body.outcome.toUpperCase() as "ALLOW" | "BLOCK" | "REVIEW" | "CHALLENGE",
          riskScore: ctx.body.risk_score,
          rulesetId: ctx.body.ruleset_id,
          ruleId: ctx.body.rule_id,
          reason: ctx.body.reason,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_decision.created",
        entityType: "RiskDecision",
        entityId: created.id,
        payload: serializeRiskDecision(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { risk_decision: serializeRiskDecision(decision) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  outcome: z.enum(["allow", "block", "review", "challenge"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.RiskDecisionWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.entity_type) where.entityType = ctx.query.entity_type;
    if (ctx.query.entity_id) where.entityId = ctx.query.entity_id;
    if (ctx.query.outcome) {
      where.outcome = ctx.query.outcome.toUpperCase() as Prisma.EnumRiskDecisionOutcomeFilter["equals"];
    }

    const skip = paginationSkip(ctx.query);
    const [total, decisions] = await Promise.all([
      prisma.riskDecision.count({ where }),
      prisma.riskDecision.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: decisions.map(serializeRiskDecision),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
