import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Low-data: translations are bundled (no network fetch). English is the complete
// base; ny/bem/ton fall back to en for any missing key. The four languages match
// the provider "languages you speak" options (en/ny/bem/ton).
const en = {
  common: {
    continue: 'Continue',
    back: 'Back',
    skip: 'Skip',
    next: 'Next',
    retry: 'Try again',
    almostThere: 'Almost there',
  },
  auth: {
    phoneTitle: 'Enter your phone number',
    phoneSub: "We'll text you a code to confirm it's you.",
    phonePlaceholder: '097 123 4567',
    sendCode: 'Send code',
    otpTitle: 'Enter the code',
    otpSub: 'We sent a 6-digit code to {{phone}}.',
    resend: 'Resend code',
    resendIn: 'Resend in {{seconds}}s',
    verify: 'Verify',
    signInToContinue: 'Sign in to continue',
  },
  browse: {
    title: 'Find a service',
    searchPlaceholder: 'Search services…',
    near: 'Near {{area}}',
    setLocation: 'Set location',
    from: 'from',
    noResults: 'No services found.',
    book: 'Book',
  },
  onboarding: {
    welcomeTitle: 'Earn doing what you do',
    welcomeSub: 'List your service, get matched with customers near you, and get paid.',
    getStarted: 'Get started',
    progress: 'Step {{current}} of {{total}}',
    aboutTitle: 'About you',
    name: 'Your name',
    photo: 'Profile photo',
    photoHint: 'This is shown to customers. It is not your ID photo.',
    area: 'Where are you based?',
    languages: 'Languages you speak',
    offerTitle: 'What do you offer?',
    offerSub: 'Pick the category that fits your work.',
    identityTitle: 'Verify your identity',
    identitySub: 'A quick check keeps the platform trusted. Your ID is private and never shown to customers.',
    nrcFront: 'NRC (front)',
    selfie: 'Selfie',
    momoNumber: 'Mobile Money number',
    serviceTitle: 'Your service',
    serviceName: 'Service title',
    price: 'Your price (ZMW)',
    availability: 'When are you available?',
    payoutTitle: 'Where should we pay you?',
    payoutSub: 'Funds go here once a booking is paid. Never shown publicly.',
    goLiveLive: "You're live!",
    goLiveLiveSub: 'Customers can now find and book you.',
    goLiveSetup: '1 step to start getting {{category}} jobs',
    tierLadder: 'Your verification ladder',
    done: 'Done',
    addLater: "I'll do this later",
  },
};

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ny: { translation: {} },
    bem: { translation: {} },
    ton: { translation: {} },
  },
  lng: localStorage.getItem('lang') ?? 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
