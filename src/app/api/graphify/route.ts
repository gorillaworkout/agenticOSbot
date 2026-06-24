import { getGraphStats, searchNodes, getNodeConnections, getCommunityNodes, getGodNodes, queryGraph } from '@/lib/graphify';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'stats';
  const q = url.searchParams.get('q') || '';
  const nodeId = url.searchParams.get('nodeId') || '';
  const communityId = parseInt(url.searchParams.get('communityId') || '-1');

  switch (action) {
    case 'stats':
      return ok(getGraphStats());
    
    case 'search':
      if (!q) return err('Query required', 400);
      return ok(searchNodes(q, 20));
    
    case 'connections':
      if (!nodeId) return err('nodeId required', 400);
      return ok(getNodeConnections(nodeId));
    
    case 'community':
      if (communityId < 0) return err('communityId required', 400);
      return ok(getCommunityNodes(communityId));
    
    case 'god-nodes':
      return ok(getGodNodes(20));
    
    case 'query':
      if (!q) return err('Query required', 400);
      return ok({ answer: queryGraph(q) });
    
    default:
      return ok(getGraphStats());
  }
}
