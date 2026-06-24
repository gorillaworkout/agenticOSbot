/**
 * Graphify Integration — Codebase Knowledge Graph for AgenticOS
 * 
 * Provides query interface to the Graphify-generated knowledge graph
 * of the AgenticOS codebase itself.
 */

import { childLogger } from './logger';
import { readFileSync } from 'fs';
import { join } from 'path';

const logger = childLogger('graphify');

interface GraphNode {
  label: string;
  id: string;
  community: number;
  source_file?: string;
  file_type?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  weight: number;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

let cachedGraph: GraphData | null = null;

function loadGraph(): GraphData {
  if (cachedGraph) return cachedGraph;
  
  try {
    const graphPath = join(process.cwd(), 'graphify-out', 'graph.json');
    const raw = readFileSync(graphPath, 'utf-8');
    const data = JSON.parse(raw);
    cachedGraph = {
      nodes: data.nodes || [],
      links: data.links || [],
    };
    logger.info({ nodes: cachedGraph.nodes.length, links: cachedGraph.links.length }, 'Graphify graph loaded');
    return cachedGraph;
  } catch (e) {
    logger.error({ err: e }, 'Failed to load Graphify graph');
    return { nodes: [], links: [] };
  }
}

export function getGraphStats(): { nodes: number; edges: number; communities: number } {
  const graph = loadGraph();
  const communities = new Set(graph.nodes.map(n => n.community));
  return {
    nodes: graph.nodes.length,
    edges: graph.links.length,
    communities: communities.size,
  };
}

export function searchNodes(query: string, limit: number = 10): GraphNode[] {
  const graph = loadGraph();
  const q = query.toLowerCase();
  return graph.nodes
    .filter(n => n.label.toLowerCase().includes(q))
    .slice(0, limit);
}

export function getNodeConnections(nodeId: string): { incoming: GraphEdge[]; outgoing: GraphEdge[] } {
  const graph = loadGraph();
  return {
    incoming: graph.links.filter(l => l.target === nodeId),
    outgoing: graph.links.filter(l => l.source === nodeId),
  };
}

export function getCommunityNodes(communityId: number): GraphNode[] {
  const graph = loadGraph();
  return graph.nodes.filter(n => n.community === communityId);
}

export function getGodNodes(limit: number = 10): { node: GraphNode; degree: number }[] {
  const graph = loadGraph();
  const degree: Record<string, number> = {};
  for (const link of graph.links) {
    degree[link.source] = (degree[link.source] || 0) + 1;
    degree[link.target] = (degree[link.target] || 0) + 1;
  }
  return Object.entries(degree)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, deg]) => ({
      node: graph.nodes.find(n => n.id === id) || { label: id, id, community: -1 },
      degree: deg,
    }));
}

export function queryGraph(question: string): string {
  const graph = loadGraph();
  
  // Simple keyword-based search
  const words = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const matches = graph.nodes.filter(n => {
    const label = n.label.toLowerCase();
    return words.some(w => label.includes(w));
  });

  if (matches.length === 0) {
    return `No nodes found matching "${question}". The graph has ${graph.nodes.length} nodes across ${new Set(graph.nodes.map(n => n.community)).size} communities.`;
  }

  let result = `Found ${matches.length} matching nodes:\n\n`;
  for (const m of matches.slice(0, 5)) {
    const conns = getNodeConnections(m.id);
    result += `**${m.label}** (community ${m.community})\n`;
    result += `  File: ${m.source_file || 'unknown'}\n`;
    result += `  Connections: ${conns.incoming.length} incoming, ${conns.outgoing.length} outgoing\n`;
    if (conns.outgoing.length > 0) {
      result += `  Calls/uses: ${conns.outgoing.slice(0, 3).map(e => e.target).join(', ')}\n`;
    }
    if (conns.incoming.length > 0) {
      result += `  Called by: ${conns.incoming.slice(0, 3).map(e => e.source).join(', ')}\n`;
    }
    result += '\n';
  }

  return result;
}
