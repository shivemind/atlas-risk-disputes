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

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const dispute = await prisma.dispute.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!dispute) {
      throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
    }

    const evidence = await prisma.disputeEvidence.findFirst({
      where: { id: ctx.params.evidenceId, disputeId: dispute.id },
    });
    if (!evidence) {
      throw new NotFoundError("EVIDENCE_NOT_FOUND", "Evidence not found.");
    }

    return NextResponse.json({ evidence: serializeEvidence(evidence) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    await prisma.$transaction(async (tx) => {
      const dispute = await tx.dispute.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!dispute) {
        throw new NotFoundError("DISPUTE_NOT_FOUND", "Dispute not found.");
      }
      if (disputeMachine.isTerminal(dispute.status as DisputeStatus)) {
        throw new ConflictError(
          "DISPUTE_CLOSED",
          "Cannot delete evidence from a closed dispute.",
        );
      }

      const evidence = await tx.disputeEvidence.findFirst({
        where: { id: ctx.params.evidenceId, disputeId: dispute.id },
      });
      if (!evidence) {
        throw new NotFoundError("EVIDENCE_NOT_FOUND", "Evidence not found.");
      }
      if (evidence.submittedAt) {
        throw new ConflictError(
          "EVIDENCE_ALREADY_SUBMITTED",
          "Cannot delete submitted evidence.",
        );
      }

      await tx.disputeEvidence.delete({ where: { id: evidence.id } });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "dispute.evidence.deleted",
        entityType: "DisputeEvidence",
        entityId: evidence.id,
        payload: serializeEvidence(evidence) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });
    });

    return NextResponse.json({ deleted: true, id: ctx.params.evidenceId });
  },
});
