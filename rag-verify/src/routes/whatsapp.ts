// src/routes/whatsapp.ts
import express from "express";
import twilio from "twilio";

const router = express.Router();

// Twilio sends URL-encoded form data
router.post(
  "/whatsapp/webhook",
  express.urlencoded({ extended: false }),
  async (req, res) => {
    console.log("Incoming WhatsApp payload:", req.body);

    const incomingMsg = req.body.Body; // message text from user
    const from = req.body.From;        // user number like 'whatsapp:+91...'

    const twiml = new twilio.twiml.MessagingResponse();

    // For now, just reply with a simple message (we'll connect to TruthSpotter later)
    if (!incomingMsg) {
      twiml.message("Send me a claim to verify.");
    } else {
      twiml.message(
        `You said: "${incomingMsg}".\n\nWhatsApp bot is connected to your backend ✅`
      );
    }

    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
  }
);

export default router;
