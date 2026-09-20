import Link from "next/link";
import { PageHead } from "@/components/ui";

export default function Unauthorized() {
  return (
    <div className="container narrow">
      <PageHead
        eyebrow="Sign in"
        title="Sign in to continue"
        lede="The prototype uses a persona switcher in place of sign-in. In the MVP this is passkeys, email codes and ORCID."
      />
      <section className="card">
        <Link className="btn" href="/persona">Choose a persona</Link>
      </section>
    </div>
  );
}
