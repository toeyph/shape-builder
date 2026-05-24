"use client";

import dynamic from "next/dynamic";

const ShapeBuilder = dynamic(() => import("../components/ShapeBuilder"), {
  ssr: false,
  loading: () => (
    <div className="h-screen flex items-center justify-center bg-sb-light font-sans text-sb-mid text-sm">
      Loading ShapeBuilder…
    </div>
  ),
});

export default function Home() {
  return <ShapeBuilder />;
}
