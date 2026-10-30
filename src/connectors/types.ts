export interface WorkItemInput {
  externalId: string;
  title: string;
  body: string;
  url: string;
  labels: string[];
}

export interface IssueSource {
  listReady(): Promise<WorkItemInput[]>;
  comment(externalId: string, body: string): Promise<void>;
}

export interface PrTimestamps {
  openedAt?: Date;
  firstReviewAt?: Date;
  mergedAt?: Date;
  merged: boolean;
  closed: boolean;
  state: string;
}
