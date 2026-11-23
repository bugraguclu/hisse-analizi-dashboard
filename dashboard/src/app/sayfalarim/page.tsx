import { Suspense } from "react";
import { CustomPagesView } from "@/components/widgets/CustomPagesView";

export default function MyPagesPage() {
  // useSearchParams (which page) needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      <CustomPagesView />
    </Suspense>
  );
}
