import Link from "next/link";
import { Notice, PageHead } from "@/components/ui";

export default function Forbidden() {
  return (
    <div className="container narrow">
      <PageHead
        eyebrow="Not authorised"
        title="Permission boundary"
        lede="Your current seat cannot see this page. Cases belong to the organisations taking part in them and to invited advisers. The administration console is a separate origin in the MVP."
      />
      <Notice kind="halt">
        Consequential refusals are written to the audit chain.
      </Notice>
      <div className="row" style={{ marginTop: 14 }}>
        <Link className="btn" href="/cases">Cases you can see</Link>
        <Link className="btn secondary" href="/persona">Choose another seat</Link>
      </div>
    </div>
  );
}
