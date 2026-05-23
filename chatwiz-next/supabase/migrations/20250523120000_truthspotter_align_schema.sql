-- Align verification_status values + message update/delete policies (safe to re-run)

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_verification_status_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_verification_status_check
  CHECK (
    verification_status IS NULL
    OR verification_status IN (
      'verified',
      'refuted',
      'unverified',
      'partially_verified',
      'true',
      'false'
    )
  );

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_confidence_check;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_confidence_check
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100));

CREATE INDEX IF NOT EXISTS idx_messages_created_at
  ON public.messages(created_at DESC);

DROP POLICY IF EXISTS "Users can update messages in their conversations" ON public.messages;
CREATE POLICY "Users can update messages in their conversations"
  ON public.messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete messages in their conversations" ON public.messages;
CREATE POLICY "Users can delete messages in their conversations"
  ON public.messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
