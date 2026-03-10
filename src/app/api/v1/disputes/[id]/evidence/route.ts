import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "@/lib/handler";
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

function serializeEvidence(e: {
  id: string;
  disputeId: string;
  type: string;
  fileName: string | null;
  fileSize: number | null;
  description: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: e.id,
    dispute_id: e.disputeId,
    type: e.type.toLowerCase(),
    file_name: e.fileName,
    file_size: e.fileSize,
    description: e.description,
    submitted_at: e.submittedAt?.toISOString() ?? null,
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
  };
}

const createEvidenceSchema = z.object({
  type: z.enum([
    "receipt",
    "shipping_proof",
    "customer_communication",
    "service_documentation",
    "policy_disclosure",
    "other",
  ]),
  file_name: z.string().max(255).optional(),
  file_size: z.number().int().positive().optional(),
  description: z.string().max(2000).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createEvidenceSchema,
  handler: async (ctx) => {
    const evidence = await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!dispute) {
        throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
      }
      if (disputeMachine.isTerminal(dispute.status as DisputeStatus)) {
        throw new ConflictError(
          "DISPUTE_CLOSED",
          "Cannot add evidence to a closed dispute.",
        );
      }

      const created = await tx.disputeEvidence.create({
        data: {
          disputeId: dispute.id,
          type: ctx.body.type.toUpperCase() as
            | "RECEIPT"
            | "SHIPPING_PROOF"
            | "CUSTOMER_COMMUNICATION"
            | "SERVICE_DOCUMENTATION"
            | "POLICY_DISCLOSURE"
            | "OTHER",
          fileName: ctx.body.file_name,
          fileSize: ctx.body.file_size,
          description: ctx.body.description,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "dispute.evidence.created",
        entityType: "DisputeEvidence",
        entityId: created.id,
        payload: serializeEvidence(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { evidence: serializeEvidence(evidence) },
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

    const skip = paginationSkip(ctx.query);
    const where = { disputeId: dispute.id };
    const [total, evidenceList] = await Promise.all([
      prisma.disputeEvidence.count({ where }),
      prisma.disputeEvidence.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: evidenceList.map(serializeEvidence),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
