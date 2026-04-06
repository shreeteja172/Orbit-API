import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-black text-[#ededed]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1200px] flex-col justify-center px-6 py-16">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.05em] text-[#888]">Developer Toolkit</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.02em] text-[#fafafa] md:text-6xl">
          API testing and monitoring built for fast shipping.
        </h1>
        <p className="mt-6 max-w-2xl text-sm leading-7 text-[#a1a1a1] md:text-base">
          Build requests, compare endpoint performance, organize collections, and catch slow APIs with threshold alerts.
          Clean dark UI, persistent storage, and a workflow designed for both developers and non-technical users.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/monitor" className="primary-btn">
            Open API Monitor
          </Link>
          <a href="#features" className="secondary-btn">
            Explore Features
          </a>
        </div>

        <section id="features" className="mt-16 grid gap-4 md:grid-cols-3">
          <article className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-[#fafafa]">Dev-friendly workflow</h2>
            <p className="mt-2 text-sm text-[#888]">Headers, auth, params, body editor, and clean response inspection with raw/pretty views.</p>
          </article>
          <article className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-[#fafafa]">User-friendly experience</h2>
            <p className="mt-2 text-sm text-[#888]">Minimal UI, clear states, search, favorites, and collections to keep workflows organized.</p>
          </article>
          <article className="rounded-lg border border-[#262626] bg-[#0a0a0a] p-5">
            <h2 className="text-sm font-semibold text-[#fafafa]">Monitoring included</h2>
            <p className="mt-2 text-sm text-[#888]">Charts, success rate, endpoint comparison, threshold alerts, and export-ready history.</p>
          </article>
        </section>
      </div>
    </main>
  );
}
