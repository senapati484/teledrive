import { useState, useEffect } from "react";
import { isMobilePlatform } from "@/lib/platform";

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return isMobilePlatform() || window.innerWidth < 768;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(isMobilePlatform() || window.innerWidth < 768);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return isMobile;
}
