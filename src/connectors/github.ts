import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";
import { githubAuthEnv, publicGitUrl } from "../git/auth.js";
import { pushHead } from "../git/workspace.js";
import { classifyMergeGate, type MergeGate } from "../temporal/ship.js";
import type { IssueSource, PrTimestamps, WorkItemInput } from "./types.js";

const exec = promisify(execFile);

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
  pushBranch(localPath: string, branch: string, opts?: { force?: boolean }): Promise<void>;
  mergePr(prNumber: number): Promise<void>;
  getMergeGate(prNumber: number): Promise<MergeGate>;
  markPrReady(prNumber: number): Promise<void>;
  closePr(prNumber: number): Promise<void>;
  closeIssue(externalId: string, comment: string): Promise<void>;
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

    async pushBranch(localPath: string, branch: string, opts?: { force?: boolean }) {
      const remote = publicGitUrl(`https://github.com/${owner}/${repo}.git`);
      await exec("git", ["remote", "set-url", "origin", remote], { cwd: localPath });
      await pushHead(localPath, branch, { force: opts?.force, env: githubAuthEnv(config.token) });
    },

    async getMergeGate(prNumber: number): Promise<MergeGate> {
      let pr = (await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })).data;
      for (let i = 0; i < 4 && pr.mergeable == null; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        pr = (await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })).data;
      }
      const { data: delta } = await octokit.rest.repos.compareCommits({
        owner,
        repo,
        base: pr.head.ref,
        head: pr.base.ref,
      });
      return classifyMergeGate({
        mergeable: pr.mergeable,
        mergeableState: pr.mergeable_state,
        behindBy: delta.ahead_by ?? 0,
        draft: Boolean(pr.draft),
        base: pr.base.ref,
        head: pr.head.ref,
        commits: delta.commits.map((commit) => commit.commit.message.split("\n")[0]).slice(-8),
      });
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

    async closeIssue(externalId: string, comment: string) {
      const issue_number = Number(externalId);
      const { data } = await octokit.rest.issues.get({ owner, repo, issue_number });
      if (data.state === "closed") return;
      if (comment) {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number,
          body: comment,
        });
      }
      await octokit.rest.issues.update({
        owner,
        repo,
        issue_number,
        state: "closed",
        state_reason: "completed",
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
