import { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-white p-6 text-center select-none">
          <div className="relative mb-6">
            <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full scale-150" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-900 border border-slate-800 shadow-xl backdrop-blur-md">
              <AlertCircle className="h-10 w-10 text-blue-400 stroke-[1.5]" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-slate-100 mb-2">{i18n.t("drive:errorBoundary.title")}</h2>
          <p className="text-sm text-slate-400 max-w-sm mb-6 leading-relaxed">
            {i18n.t("drive:errorBoundary.description")}
          </p>
          <Button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold px-6 py-2.5 text-sm gap-2 shadow-lg shadow-blue-600/20 text-white transition-all duration-200"
          >
            <RotateCcw className="h-4 w-4" />
            {i18n.t("drive:errorBoundary.reload")}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
