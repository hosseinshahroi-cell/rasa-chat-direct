import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SUBJECTS = [
  "هرزنامه (اسپم)",
  "کلاهبرداری",
  "محتوای نامناسب",
  "آزار و اذیت",
  "جعل هویت",
  "سایر",
];

export function ReportDialog({
  open, onOpenChange, reportedUserId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reportedUserId: string;
}) {
  const [subject, setSubject] = useState(SUBJECTS[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim() || reason.length > 1000) {
      toast.error("لطفاً علت گزارش را بنویسید (حداکثر ۱۰۰۰ کاراکتر)");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("report_user", {
      reported: reportedUserId, p_subject: subject, p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("گزارش شما ثبت شد. متشکریم.");
    setReason("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>گزارش کاربر</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">موضوع</label>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">علت</label>
            <Textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="توضیح دهید..." rows={4} maxLength={1000}
            />
            <p className="text-[10px] text-muted-foreground mt-1">{reason.length}/1000</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>انصراف</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "..." : "ارسال گزارش"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
