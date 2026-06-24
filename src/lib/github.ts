/**
 * GOR-139: GitHub tools — issues, PRs, Actions, file read/write via OAuth token.
 * Uses the unified OAuth connection from oauth.ts.
 */
import { childLogger } from './logger';

const log = childLogger('github');

const GITHUB_API = 'https://api.github.com';

interface GitHubOptions {
  token: string;
  owner?: string;
  repo?: string;
}

async function githubFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) return { error: data.message || `GitHub API error ${res.status}`, data: null };
  return { error: null, data };
}

// === Issues ===

export async function listIssues(token: string, owner: string, repo: string, state = 'open') {
  return githubFetch(`/repos/${owner}/${repo}/issues?state=${state}&per_page=20`, token);
}

export async function getIssue(token: string, owner: string, repo: string, issueNumber: number) {
  return githubFetch(`/repos/${owner}/${repo}/issues/${issueNumber}`, token);
}

export async function createIssue(token: string, owner: string, repo: string, title: string, body?: string, labels?: string[]) {
  return githubFetch(`/repos/${owner}/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify({ title, body, labels }),
  });
}

export async function updateIssue(token: string, owner: string, repo: string, issueNumber: number, updates: { title?: string; body?: string; state?: string; labels?: string[] }) {
  return githubFetch(`/repos/${owner}/${repo}/issues/${issueNumber}`, token, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

export async function addIssueComment(token: string, owner: string, repo: string, issueNumber: number, body: string) {
  return githubFetch(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, token, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

// === Pull Requests ===

export async function listPullRequests(token: string, owner: string, repo: string, state = 'open') {
  return githubFetch(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=20`, token);
}

export async function getPullRequest(token: string, owner: string, repo: string, prNumber: number) {
  return githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`, token);
}

export async function createPullRequest(token: string, owner: string, repo: string, title: string, head: string, base: string, body?: string) {
  return githubFetch(`/repos/${owner}/${repo}/pulls`, token, {
    method: 'POST',
    body: JSON.stringify({ title, head, base, body }),
  });
}

// === Actions / Workflows ===

export async function listWorkflows(token: string, owner: string, repo: string) {
  return githubFetch(`/repos/${owner}/${repo}/actions/workflows?per_page=20`, token);
}

export async function listWorkflowRuns(token: string, owner: string, repo: string, workflowId?: string) {
  const path = workflowId
    ? `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=10`
    : `/repos/${owner}/${repo}/actions/runs?per_page=10`;
  return githubFetch(path, token);
}

export async function triggerWorkflow(token: string, owner: string, repo: string, workflowId: string, ref = 'main', inputs?: Record<string, string>) {
  return githubFetch(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, token, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs }),
  });
}

export async function rerunWorkflow(token: string, owner: string, repo: string, runId: number) {
  return githubFetch(`/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, token, {
    method: 'POST',
  });
}

// === File Operations ===

export async function getFile(token: string, owner: string, repo: string, path: string, ref?: string) {
  const query = ref ? `?ref=${ref}` : '';
  return githubFetch(`/repos/${owner}/${repo}/contents/${path}${query}`, token);
}

export async function createOrUpdateFile(token: string, owner: string, repo: string, path: string, content: string, message: string, sha?: string, branch?: string) {
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  return githubFetch(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function deleteFile(token: string, owner: string, repo: string, path: string, message: string, sha: string, branch?: string) {
  return githubFetch(`/repos/${owner}/${repo}/contents/${path}`, token, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, ...(branch && { branch }) }),
  });
}

// === Repos ===

export async function listRepos(token: string, perPage = 20) {
  return githubFetch(`/user/repos?per_page=${perPage}&sort=updated`, token);
}

export async function getRepo(token: string, owner: string, repo: string) {
  return githubFetch(`/repos/${owner}/${repo}`, token);
}

// === User ===

export async function getCurrentUser(token: string) {
  return githubFetch('/user', token);
}
