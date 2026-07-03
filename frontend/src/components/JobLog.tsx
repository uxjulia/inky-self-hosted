import type { Job } from "../appTypes";

type JobLogProps = {
  jobs: Job[];
};

export function JobLog({ jobs }: JobLogProps) {
  if (jobs.length === 0) return null;
  return (
    <pre className="job-log" aria-label="Latest device job">
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
  const progress = message.startsWith("Uploading to device (") ? ` ${job.progress}%` : "";
  return `[${status}] ${job.type}${progress}${message ? ` - ${message}` : ""}`;
}

function jobLogClassName(job: Job) {
  if (job.error || job.status === "failed") return "job-log-line job-log-line-error";
  if ((job.type === "send" || job.type === "dictionary_prepare") && job.status === "succeeded") {
    return "job-log-line job-log-line-success";
  }
  return "job-log-line";
}
