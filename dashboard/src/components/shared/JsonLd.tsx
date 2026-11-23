import { serializeJsonLd } from "@/lib/schema";

/** Renders one or more schema.org JSON-LD blocks safely. */
export function JsonLd({ data }: { data: unknown | readonly unknown[] }) {
  const nodes = Array.isArray(data) ? data : [data];
  return (
    <>
      {nodes.map((node, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(node) }}
        />
      ))}
    </>
  );
}
