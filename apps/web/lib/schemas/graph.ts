import { z } from "zod";

export const nodeKindSchema = z.enum([
  "startEvent",
  "endEvent",
  "intermediateEvent",
  "task",
  "userTask",
  "serviceTask",
  "scriptTask",
  "gateway",
  "exclusiveGateway",
  "parallelGateway",
  "inclusiveGateway",
  "subprocess",
]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const nodeStatusSchema = z.enum(["idle", "active", "blocked", "done"]);
export type NodeStatus = z.infer<typeof nodeStatusSchema>;

export const nodeDataSchema = z
  .object({
    label: z.string(),
    description: z.string().nullable().optional(),
    duration_ms: z.number().int().nonnegative().nullable().optional(),
    assignee: z.string().nullable().optional(),
    cost: z.number().nonnegative().nullable().optional(),
    status: nodeStatusSchema.default("idle"),
  })
  .passthrough();
export type NodeData = z.infer<typeof nodeDataSchema>;

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const serverNodeSchema = z.object({
  id: z.string(),
  type: nodeKindSchema,
  position: positionSchema,
  data: nodeDataSchema,
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
});
export type ServerNode = z.infer<typeof serverNodeSchema>;

export const serverEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  animated: z.boolean().optional().default(false),
});
export type ServerEdge = z.infer<typeof serverEdgeSchema>;

export const graphSchema = z.object({
  nodes: z.array(serverNodeSchema),
  edges: z.array(serverEdgeSchema),
});
export type Graph = z.infer<typeof graphSchema>;

export const processSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  node_count: z.number().int(),
  edge_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ProcessSummary = z.infer<typeof processSummarySchema>;

export const processDetailSchema = processSummarySchema.extend({
  graph: graphSchema,
});
export type ProcessDetail = z.infer<typeof processDetailSchema>;

export const processSaveResponseSchema = z.object({
  id: z.string(),
  node_count: z.number().int(),
  edge_count: z.number().int(),
  updated_at: z.string(),
  validation_warnings: z.array(z.string()).default([]),
});
export type ProcessSaveResponse = z.infer<typeof processSaveResponseSchema>;
