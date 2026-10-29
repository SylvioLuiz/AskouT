// English courtesy translation of the legal texts. The Portuguese version (legal-text.ts) prevails.
// DRAFT: needs review by a lawyer together with the Portuguese text before launch (see GOLIVE.md).
import { COMPANY, LEGAL_UPDATED_EN } from './legal-text-shared.ts';
import type { LegalDoc } from './legal-text-shared.ts';

const NOTICE = 'Courtesy translation. If there is any difference, the Portuguese version prevails.';

export function buildPrivacyEn(email: string): LegalDoc {
  return {
    title: 'Privacy Policy',
    notice: NOTICE,
    updated: LEGAL_UPDATED_EN,
    intro:
      'AskouT helps friends arrange in-person meetups. This policy explains which personal data we process, why, who we share it with and how you can exercise your rights, under the Brazilian General Data Protection Law (Law 13,709/2018, the LGPD).',
    blocks: [
      {
        title: '1. Who is responsible',
        text: [
          `The data controller is ${COMPANY.name}, CNPJ ${COMPANY.cnpj}, headquartered at ${COMPANY.address}, the company that operates AskouT.`,
          `For any privacy matter, including contacting the data protection officer (DPO), ${COMPANY.dpo}, write to ${email}.`,
        ],
      },
      {
        title: '2. Which data we process',
        items: [
          'Account: email, @username, name and password (stored irreversibly, never in plain text). If you sign in with Google or Apple, we receive their identity confirmation and the account email.',
          'Date of birth: requested at sign-up to check the minimum age (18). It is not shown to other people. You can correct it in Edit profile (anyone recorded as under 18 should contact support). We also store the day and version of the Terms you accepted when creating the account.',
          'Profile and content: profile photo, posts, photos, videos, events you post, comments, likes, and messages in chats and groups.',
          'Relationships: who you follow, who follows you, who you blocked and the people you approve on a private profile. Two profiles that follow each other are "friends" on AskouT.',
          'Calendar and plans: the days and times you mark as available, the "Flash" modes (temporary availability), date polls and attendance at events.',
          'Location: only when you allow it. In Explore and on the map, we use the device position to find places and events nearby and we do not store that position. In "My area" (optional), we store a rounded coordinate (about 1 km) for regional ads. You can delete it at any time.',
          'Use for recommendations: how long you spend on each piece of content and whether you opened links, to build the "For you" block. This can be turned off, and when you turn it off we delete the measured history.',
          'Notifications: if you enable notifications, we store the technical delivery address of your browser or device.',
          'Payments (venue owners who boost): the order history and payment status. Card data stays only with the payment processor, never with us.',
          'Technical data: the IP address, used for security and to limit abusive attempts. This control is kept only in the server memory, for a short time.',
        ],
      },
      {
        title: '3. What we use it for and the legal basis',
        items: [
          'Create and maintain your account, show your profile and allow chats, plans and events: performance of the contract (Terms of Use).',
          'Show places and events near you and use your area for regional ads: consent, given when you allow location or tap "Use my current location". You can withdraw it whenever you want.',
          'Recommendations based on your use: legitimate interest and, when required, consent. There is a switch to turn it off in Privacy.',
          'Security, fraud and abuse prevention, and limiting improper access attempts: legitimate interest and protection of credit and security.',
          'Send codes and notices by email that are necessary for the service: performance of the contract.',
          'Comply with legal obligations and respond to orders from authorities: legal obligation.',
        ],
      },
      {
        title: '4. Who sees what',
        text: [
          'Your profile, posts and events appear to people according to your settings. With a private profile, only people you approve see the events you post, your calendar and your connections. Messages only reach people in the conversation.',
          'We do not sell your personal data and we do not use what you do on AskouT for third-party advertising.',
        ],
      },
      {
        title: '5. Who we share it with so the service works',
        items: [
          'Hosting and database (Railway) and network, DNS and website hosting (Cloudflare): store and deliver the app data.',
          'Email delivery (Resend): receives your email and the text of the code or notice.',
          'Place search (Google Places and OpenStreetMap): receive the approximate area of your query to return nearby places, without your name or your account.',
          'Map: the map provider receives your IP and the map area you are viewing.',
          'Payments (Stripe, and the Apple and Google stores in the app): process the boost charge.',
          'Sign in with Google or Apple: they know you signed in to AskouT.',
          'Authorities, when there is a legal order.',
        ],
      },
      {
        title: '6. Transfer outside Brazil',
        text: ['Some of these providers store or process data in other countries. When this happens, we look for providers that offer adequate protection and contracts compatible with the LGPD.'],
      },
      {
        title: '7. How long we keep it',
        items: [
          'Account and content data stay while the account exists, or until you delete the content.',
          'Confirmation codes expire in a few minutes. "Flash" availability disappears on its own when it expires.',
          'The time-per-content history and the area can be deleted by you at any time in Privacy.',
          'We may keep the minimum necessary for longer when the law requires it (for example, tax records of payments) or for defense in proceedings.',
        ],
      },
      {
        title: '8. Your rights',
        text: [
          'Under the LGPD, you may request: confirmation that we process your data; access; correction; anonymization, blocking or deletion of unnecessary data or data processed unlawfully; portability; information about who we share it with; deletion of data processed with consent; and withdrawal of consent. You may also object to processing and request review of automated decisions.',
          `Some of this you can do yourself in the app, in Privacy: edit your profile, make your profile private, block people, turn off recommendations, delete the area and the usage history, download a copy of your data and delete your account. When you delete the account, we remove your profile, posts, comments, messages, calendar and other data linked to it. For other requests, write to ${email}. We reply within 15 days.`,
          'If you believe your data was handled incorrectly, you may also complain to the Brazilian National Data Protection Authority (ANPD).',
        ],
      },
      {
        title: '9. Security',
        text: ['We use encrypted connections (HTTPS), store passwords irreversibly, limit access attempts and restrict which team members can access data. No system is completely secure: if an incident occurs that may cause you a relevant risk, we will notify you and the ANPD, as the law requires.'],
      },
      {
        title: '10. Children and teenagers',
        text: ['AskouT is only for people aged 18 or older, and sign-up does not accept anyone younger. We do not want data from people under 18: if we learn that an account belongs to someone below that age, we will close it. [To be reviewed by a lawyer before launch: rules of the Brazilian Digital Child and Adolescent Statute (Law 15,211/2025).]'],
      },
      {
        title: '11. Storage on your device',
        text: ['We store on your device only what the app needs to work: login session, theme and preferences. We do not use advertising cookies or third-party trackers for ads.'],
      },
      {
        title: '12. Changes to this policy',
        text: [`We may update this policy. When the change is relevant, we will notify you in the app. The version date is at the top of this page. Last updated: ${LEGAL_UPDATED_EN}.`],
      },
    ],
  };
}

export function buildTermsEn(email: string): LegalDoc {
  return {
    title: 'Terms of Use',
    notice: NOTICE,
    updated: LEGAL_UPDATED_EN,
    intro: `These terms apply to everyone who uses AskouT, operated by ${COMPANY.name}, CNPJ ${COMPANY.cnpj}, ${COMPANY.address}. By creating an account or signing in, you agree to them and to the Privacy Policy.`,
    blocks: [
      {
        title: '1. What AskouT is',
        text: ['An app to arrange in-person meetups with friends and discover bars, venues and events. Two profiles that follow each other are "friends" here.'],
      },
      {
        title: '2. Your account',
        items: [
          'You must be 18 or older to have an account, and provide truthful information, including your date of birth.',
          'You are responsible for your password and for everything that happens on your account. Tell us if you think someone else used it.',
          'Each person may have one account. Fake accounts, which impersonate other people or are made to deceive, may be removed.',
        ],
      },
      {
        title: '3. Your content',
        text: [
          'Photos, videos, texts and messages you publish remain yours. You give us a limited, free permission, only to operate the service, to store and show this content to the people you choose, according to your privacy settings.',
          'You guarantee that you have the right to publish what you publish, including images of other people.',
        ],
      },
      {
        title: '4. What is not allowed',
        items: [
          'Harassing, threatening, discriminating against or exposing other people, and publishing sexual content involving minors or without consent (which will always be removed and may be reported to the authorities).',
          'Publishing third parties\' personal data, or using the app for scams, spam or unauthorized advertising.',
          'Trying to bypass security, guess passwords, collect data in bulk or use bots without authorization.',
          'Breaking the law or violating third-party rights.',
        ],
        text: ['Zero tolerance: offensive, hateful, violent or sexual content and abusive users are not tolerated. The content will be removed and the person who posted it may have their account suspended or deleted.'],
      },
      {
        title: '5. Reports, blocking and moderation',
        items: [
          'You can report profiles, posts, comments, stories and conversations in the app itself (the options menu of each item) and block anyone at any time.',
          'Our team reviews reports within 24 hours, removes content that breaks these terms and removes from the platform the person who posted it. Blocking someone also notifies our team and makes that person\'s content disappear from your feed immediately.',
          `For reports that do not fit in the app or urgent cases, write to ${email}.`,
        ],
      },
      {
        title: '6. Venues, events and third-party links',
        text: [
          'Information about venues and events comes from venue owners, public sources and other users, and may be out of date or incorrect. Check the time and address before going out. Items marked "[TESTE]" are examples only.',
          'The "Buy ticket" button takes you to a third-party sales website. AskouT does not sell, charge for or deliver tickets, and is not responsible for that website or the purchase.',
          'In-person meetups involve risks. Use common sense, meet in public places and look after your safety and that of the people with you.',
        ],
      },
      {
        title: '7. Venue owners and boosts',
        text: ['Whoever manages a venue declares that they are authorized to do so. A boost is a paid ad, always labeled "Sponsored". Prices, billing method and cancellation and refund rules are shown before purchase. Refund: if the boost has not started to be displayed, you may cancel and get your money back; the 7-day right of withdrawal of the Brazilian Consumer Protection Code for purchases made outside a physical store also applies. If a failure on our side prevents display, we refund the proportional amount for the period not delivered. Purchases made through Apple or Google also follow the store\'s refund rules. [To be reviewed by a lawyer before launch.]'],
      },
      {
        title: '8. Suspension and termination',
        text: ['You may stop using AskouT whenever you want and ask for your account to be deleted through the privacy email. We may suspend or close accounts that break these terms, with notice when possible.'],
      },
      {
        title: '9. Liability',
        text: ['We provide AskouT as it is, and we strive to keep it online and secure, but we do not guarantee that it will never have failures. To the extent permitted by law, we are not liable for meetups between users, for third-party content or for indirect losses. Nothing here limits rights that the law gives you as a consumer.'],
      },
      {
        title: '10. Changes, law and jurisdiction',
        text: [
          `We may update these terms and we will notify you in the app when the change is relevant. Last updated: ${LEGAL_UPDATED_EN}.`,
          'The laws of Brazil apply. The courts of the consumer\'s domicile are chosen to resolve disputes.',
          `Questions: ${email}.`,
        ],
      },
    ],
  };
}
