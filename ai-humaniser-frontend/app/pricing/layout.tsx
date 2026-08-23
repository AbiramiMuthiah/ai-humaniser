import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Compare Ashumanizer's Free, Basic, Pro, and Unlimited plans. Humanize AI text starting at RM0 — see word limits, daily quotas, and features for each tier.",
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
