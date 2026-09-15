import { Notice } from "@/components/ui";

export default function Forbidden() {
  return (
    <div className="container">
      <Notice kind="halt">
        <strong>Permission boundary.</strong> This content is visible to the organisations taking part in it, their invited advisers, and administrators acting through recorded interventions. In the MVP the administration console runs on a separate origin with mandatory multi-factor authentication. Consequential refusals are written to the audit chain.
      </Notice>
    </div>
  );
}
