import { useParams } from "react-router-dom";

export function useProjectId() {
  return useParams().projectId!;
}
