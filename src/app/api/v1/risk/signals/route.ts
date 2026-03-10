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

function serializeRiskSignal(s: {
  id: string;
  merchantId: string;
  entityType: string;
  entityId: string;
  signalType: string;
  severity: string;
  details: unknown;
  createdAt: Date;
}) {
  return {
    id: s.id,
    merchant_id: s.merchantId,
    entity_type: s.entityType,
    entity_id: s.entityId,
    signal_type: s.signalType,
    severity: s.severity.toLowerCase(),
    details: s.details,
    created_at: s.createdAt.toISOString(),
  };
}

const createSignalSchema = z.object({
  entity_type: z.string().min(1).max(100),
  entity_id: z.string().min(1).max(200),
  signal_type: z.string().min(1).max(100),
  severity: z.enum(["low", "medium", "high", "critical"]).default("low"),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createSignalSchema,
  handler: async (ctx) => {
    const signal = await prisma.$transaction(async (tx) => {
      const created = await tx.riskSignal.create({
        data: {
          merchantId: ctx.merchantId,
          entityType: ctx.body.entity_type,
          entityId: ctx.body.entity_id,
          signalType: ctx.body.signal_type,
          severity: ctx.body.severity.toUpperCase() as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
          details: ctx.body.details as Prisma.InputJsonValue | undefined,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "risk_signal.created",
        entityType: "RiskSignal",
        entityId: created.id,
        payload: serializeRiskSignal(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { risk_signal: serializeRiskSignal(signal) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.RiskSignalWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.entity_type) where.entityType = ctx.query.entity_type;
    if (ctx.query.entity_id) where.entityId = ctx.query.entity_id;
    if (ctx.query.severity) {
      where.severity = ctx.query.severity.toUpperCase() as Prisma.EnumRiskLevelFilter["equals"];
    }

    const skip = paginationSkip(ctx.query);
    const [total, signals] = await Promise.all([
      prisma.riskSignal.count({ where }),
      prisma.riskSignal.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: signals.map(serializeRiskSignal),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
