import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const FeedbackModal = () => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 1000) return;
    setSaving(true);
    const { error } = await supabase.from("feedback").insert({ suggestion: trimmed });
    setSaving(false);
    if (error) {
      toast.error("Failed to submit. Try again.");
      return;
    }
    toast.success("Thanks — we'll take a look.");
    setText("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="text-sm text-muted-foreground hover:text-primary transition-colors">
          💡 Know a great source we're missing? Suggest one
        </button>
      </DialogTrigger>
      <DialogContent className="glass border-white/10">
        <DialogHeader>
          <DialogTitle>Suggest a source</DialogTitle>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. FinTech Futures — great daily EU coverage"
          maxLength={1000}
          rows={4}
        />
        <div className="flex justify-end">
          <Button onClick={submit} disabled={saving || !text.trim()}>
            {saving ? "Sending…" : "Send"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
