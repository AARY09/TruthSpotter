"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/whatsapp.ts
const express_1 = __importDefault(require("express"));
const twilio_1 = __importDefault(require("twilio"));
const router = express_1.default.Router();
// Twilio sends URL-encoded form data
router.post("/whatsapp/webhook", express_1.default.urlencoded({ extended: false }), async (req, res) => {
    console.log("Incoming WhatsApp payload:", req.body);
    const incomingMsg = req.body.Body; // message text from user
    const from = req.body.From; // user number like 'whatsapp:+91...'
    const twiml = new twilio_1.default.twiml.MessagingResponse();
    // For now, just reply with a simple message (we'll connect to TruthSpotter later)
    if (!incomingMsg) {
        twiml.message("Send me a claim to verify.");
    }
    else {
        twiml.message(`You said: "${incomingMsg}".\n\nWhatsApp bot is connected to your backend ✅`);
    }
    res.set("Content-Type", "text/xml");
    res.send(twiml.toString());
});
exports.default = router;
//# sourceMappingURL=whatsapp.js.map