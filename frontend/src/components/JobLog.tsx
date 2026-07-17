import type { Job } from "../appTypes";

type JobLogProps = {
  jobs: Job[];
  ariaLabel?: string;
};

export function JobLog({ jobs, ariaLabel = "Latest device job" }: JobLogProps) {
  if (jobs.length === 0) return null;
  return (
    <pre className="job-log" aria-label={ariaLabel}>
      {jobs.map((job) => (
        <code key={job.id} className={jobLogClassName(job)}>
          {formatJobLog(job)}
        </code>
      ))}
    </pre>
  );
}

function formatJobLog(job: Job) {
  const status = job.error ? "error" : job.status;
  const message = job.error || job.message || job.status;
  const progress = formatJobProgress(job);
  const details = [progress, message].filter(Boolean).join(" ");
  return `[${status}] ${job.type}${details ? ` - ${details}` : ""}`;
}

function jobLogClassName(job: Job) {
  if (job.error || job.status === "failed") return "job-log-line job-log-line-error";
  if (job.status === "canceled") return "job-log-line job-log-line-canceled";
  if ((job.type === "send" || job.type === "dictionary_prepare") && job.status === "succeeded") {
    return "job-log-line job-log-line-success";
  }
  return "job-log-line";
}

function formatJobProgress(job: Job) {
  if (job.type !== "send" || job.status !== "running") return "";
  if (!Number.isFinite(job.progress)) return "";
  return `(${Math.max(0, Math.min(100, Math.round(job.progress)))}%)`;
}
