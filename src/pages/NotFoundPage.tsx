import { FileQuestion } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  const { t } = useTranslation("drive");
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-8 text-center">
      <FileQuestion className="h-16 w-16 text-muted-foreground mb-4" />
      <h2 className="text-2xl font-bold tracking-tight mb-2">{t("notFound.title")}</h2>
      <p className="text-muted-foreground mb-6">{t("notFound.description")}</p>
      <Link to="/drive/my-drive">
        <Button>{t("notFound.goToMyDrive")}</Button>
      </Link>
    </div>
  );
}
