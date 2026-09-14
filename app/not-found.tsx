import Link from "next/link";
import { PageHead } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="container narrow">
      <PageHead
        eyebrow="Not found"
        title="There is nothing at this address"
        lede="The record may have been reset with the demo state, or the address may be mistyped. Nothing has been changed or recorded by this request."
      />
      <section className="card">
        <div className="row">
          <Link className="btn" href="/">Back to the start</Link>
          <Link className="btn secondary" href="/explore">Explore opportunities</Link>
          <Link className="btn ghost" href="/cases">Your cases</Link>
        </div>
      </section>
    </div>
  );
}
