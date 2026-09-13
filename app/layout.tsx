import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "GENE-LINK MVP prototype",
  description: "A working prototype of the GENE-LINK partnership journey: country rules as configuration, three-state requirements, halts on unknowns, and an auditable pipeline from discovery to a recorded agreement.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
