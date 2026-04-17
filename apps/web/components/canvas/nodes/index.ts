import type { NodeTypes } from "@xyflow/react";
import { TaskNode } from "./TaskNode";
import { EventNode } from "./EventNode";
import { GatewayNode } from "./GatewayNode";
import { SubprocessNode } from "./SubprocessNode";

export const nodeTypes: NodeTypes = {
  startEvent: EventNode,
  endEvent: EventNode,
  intermediateEvent: EventNode,

  task: TaskNode,
  userTask: TaskNode,
  serviceTask: TaskNode,
  scriptTask: TaskNode,

  gateway: GatewayNode,
  exclusiveGateway: GatewayNode,
  parallelGateway: GatewayNode,
  inclusiveGateway: GatewayNode,

  subprocess: SubprocessNode,
};

export const nodeColorMap: Record<string, string> = {
  startEvent: "var(--success)",
  endEvent: "var(--error)",
  intermediateEvent: "var(--text-muted)",
  task: "var(--primary)",
  userTask: "var(--primary)",
  serviceTask: "var(--primary)",
  scriptTask: "var(--primary)",
  gateway: "var(--warning)",
  exclusiveGateway: "var(--warning)",
  parallelGateway: "var(--warning)",
  inclusiveGateway: "var(--warning)",
  subprocess: "var(--info)",
};
