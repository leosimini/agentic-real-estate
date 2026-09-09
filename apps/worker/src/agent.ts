import { StateGraph, StateSchema, START, END, type GraphNode } from '@langchain/langgraph';
import { z } from 'zod/v4';

const MonitorState = new StateSchema({
  monitor: z.record(z.string(), z.unknown()),
  candidates: z.array(z.record(z.string(), z.unknown())).default(() => []),
  changes: z.array(z.record(z.string(), z.unknown())).default(() => []),
  alert: z.record(z.string(), z.unknown()).nullable().default(null)
});

const interpretIntent: GraphNode<typeof MonitorState> = async (state) => {
  // MVP: criteria are persisted in structured form. A provider-backed node can
  // replace this without changing the monitor workflow contract.
  return { monitor: state.monitor };
};

const analyzeChanges: GraphNode<typeof MonitorState> = async (state) => {
  const changes = state.candidates.slice(0, 5).map((candidate) => ({
    propertyId: String(candidate.id ?? ''),
    type: candidate.isNew ? 'new_match' : 'still_matching',
    score: Number(candidate.score ?? 0)
  }));
  return { changes };
};

const composeAlert: GraphNode<typeof MonitorState> = async (state) => {
  if (!state.changes.length) return { alert: null };
  return {
    alert: {
      title: `${state.changes.length} meaningful real-estate changes`,
      body: `Your monitor found ${state.changes.length} changes worth reviewing.`,
      payload: { changes: state.changes }
    }
  };
};

export const monitorAgent = new StateGraph(MonitorState)
  .addNode('interpret_intent', interpretIntent)
  .addNode('analyze_changes', analyzeChanges)
  .addNode('compose_alert', composeAlert)
  .addEdge(START, 'interpret_intent')
  .addEdge('interpret_intent', 'analyze_changes')
  .addEdge('analyze_changes', 'compose_alert')
  .addEdge('compose_alert', END)
  .compile();
