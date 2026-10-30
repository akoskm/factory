import { Octokit } from "@octokit/rest";
import type { IssueSource, PrTimestamps, WorkItemInput } from "./types.js";

export interface GitHubSourceConfig {
  owner: string;
  repo: string;
  label: string;
  token: string;
}

export function createGitHubSource(config: GitHubSourceConfig): IssueSource & {
  getPrTimestamps(prNumber: number): Promise<PrTimestamps>;
  ensureBranchAndPr(input: {
    branch: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<{ prNumber: number; prUrl: string; created: boolean }>;
  pushBranch(localPath: string, branch: string): Promise<void>;
  mergePr(prNumber: number): Promise<void>;
  markPrReady(prNumber: number): Promise<void>;
  closePr(prNumber: number): Promise<void>;
  deleteBranch(branch: string): Promise<void>;
} {
  const octokit = new Octokit({ auth: config.token });
  const { owner, repo, label } = config;

  return {
    async listReady(): Promise<WorkItemInput[]> {
      const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
        owner,
        repo,
        state: "open",
        labels: label,
        per_page: 100,
      });
      return issues
        .filter((i) => !i.pull_request)
        .map((i) => ({
          externalId: String(i.number),
          title: i.title,
          body: i.body ?? "",
          url: i.html_url,
          labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name ?? "")),
        }));
    },

    async comment(externalId: string, body: string): Promise<void> {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: Number(externalId),
        body,
      });
    },

    async getPrTimestamps(prNumber: number): Promise<PrTimestamps> {
      const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });
      const firstHuman = reviews
        .filter((r) => r.user?.type === "User" && r.submitted_at)
        .sort((a, b) => Date.parse(a.submitted_at!) - Date.parse(b.submitted_at!))[0];
      return {
        openedAt: pr.created_at ? new Date(pr.created_at) : undefined,
        firstReviewAt: firstHuman?.submitted_at ? new Date(firstHuman.submitted_at) : undefined,
        mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
        merged: Boolean(pr.merged),
        closed: pr.state === "closed",
        state: pr.state,
      };
    },

    async ensureBranchAndPr(input) {
      const existing = await octokit.paginate(octokit.rest.pulls.list, {
        owner,
        repo,
        state: "open",
        head: `${owner}:${input.branch}`,
        per_page: 10,
      });
      if (existing[0]) {
        return { prNumber: existing[0].number, prUrl: existing[0].html_url, created: false };
      }
      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: input.title,
        head: input.branch,
        base: input.base,
        body: input.body,
        draft: input.draft ?? true,
      });
      return { prNumber: data.number, prUrl: data.html_url, created: true };
    },

    async pushBranch(localPath: string, branch: string) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      const remote = `https://x-access-token:${config.token}@github.com/${owner}/${repo}.git`;
      await exec("git", ["remote", "set-url", "origin", remote], { cwd: localPath });
      await exec("git", ["push", "-u", "origin", `HEAD:${branch}`], { cwd: localPath });
    },

    async mergePr(prNumber: number) {
      await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: "squash",
      });
    },

    async markPrReady(prNumber: number) {
      await octokit.graphql(
        `mutation($id: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $id }) {
            pullRequest { id }
          }
        }`,
        {
          id: (
            await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })
          ).data.node_id,
        },
      );
    },

    async closePr(prNumber: number) {
      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        state: "closed",
      });
    },

    async deleteBranch(branch: string) {
      try {
        await octokit.rest.git.deleteRef({
          owner,
          repo,
          ref: `heads/${branch}`,
        });
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status !== 404) throw err;
      }
    },
  };
}
