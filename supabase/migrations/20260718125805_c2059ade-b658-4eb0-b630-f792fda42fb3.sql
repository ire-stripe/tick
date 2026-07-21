
CREATE TABLE public.articles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  summary TEXT,
  region TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_breaking BOOLEAN NOT NULL DEFAULT false,
  is_in_brief BOOLEAN NOT NULL DEFAULT false,
  global_ticker BOOLEAN NOT NULL DEFAULT false
);
GRANT SELECT ON public.articles TO anon, authenticated;
GRANT ALL ON public.articles TO service_role;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "articles readable by all" ON public.articles FOR SELECT USING (true);

CREATE TABLE public.episodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  region TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  audio_url TEXT,
  script TEXT,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.episodes TO anon, authenticated;
GRANT ALL ON public.episodes TO service_role;
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "episodes readable by all" ON public.episodes FOR SELECT USING (true);

CREATE TABLE public.feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  suggestion TEXT NOT NULL,
  submitted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.feedback TO anon, authenticated;
GRANT ALL ON public.feedback TO service_role;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can submit feedback" ON public.feedback FOR INSERT WITH CHECK (true);

CREATE TABLE public.subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_user_id TEXT NOT NULL,
  region TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO anon, authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions open" ON public.subscriptions FOR ALL USING (true) WITH CHECK (true);

-- Seed articles
INSERT INTO public.articles (title, source, url, summary, region, is_breaking, is_in_brief, global_ticker, published_at) VALUES
('Klarna posts record Q3 revenue driven by US expansion','Finextra','https://www.finextra.com/','Klarna reported a 32% YoY revenue jump, credited to aggressive US retailer partnerships and higher basket sizes.','nordics',false,true,true, now() - interval '5 hours'),
('Sweden''s Riksbank pilots wholesale CBDC settlement','Sifted','https://sifted.eu/','The Riksbank completed a live pilot of a wholesale CBDC for interbank settlement with SEB and Handelsbanken.','nordics',true,false,true, now() - interval '20 minutes'),
('Nordnet acquires Danish robo-advisor for €120M','Bloomberg','https://www.bloomberg.com/','Nordnet expands its Danish retail footprint with the acquisition of June Markets.','nordics',false,true,false, now() - interval '7 hours'),
('Lunar bank raises €40M Series E led by Kinnevik','TechCrunch','https://techcrunch.com/','The Aarhus-based challenger bank will use the funds to expand SME lending across Denmark and Norway.','nordics',false,true,false, now() - interval '9 hours'),
('Vipps MobilePay hits 12M active users','Finans.dk','https://finans.dk/','The merged Nordic wallet crosses a milestone as Norwegian merchant adoption accelerates.','nordics',false,false,false, now() - interval '2 hours'),

('Adyen beats Q3 earnings expectations','Reuters','https://reuters.com/','Amsterdam-based Adyen reported 22% net revenue growth, with strong North American volume.','benelux',false,true,true, now() - interval '6 hours'),
('ING launches AI-powered fraud detection across Benelux','Finextra','https://finextra.com/','The bank rolled out a real-time ML model that reduced card fraud losses by 38% in pilot markets.','benelux',false,true,false, now() - interval '10 hours'),
('Belgian regulator fines Bunq €2.3M over KYC gaps','FD.nl','https://fd.nl/','The FSMA imposed the fine following a 2024 review of neobank onboarding controls.','benelux',true,false,false, now() - interval '45 minutes'),
('Mollie IPO reportedly delayed to 2027','Bloomberg','https://bloomberg.com/','Sources say the Dutch payments firm is waiting for improved public market conditions.','benelux',false,true,false, now() - interval '8 hours'),
('Rabobank pilots deposit tokenization on public chain','Stripe','https://stripe.com/blog','Rabobank tested tokenized euro deposits with corporate clients using a permissioned Ethereum L2.','benelux',false,true,false, now() - interval '3 hours'),

('Revolut secures Polish banking license','Rzeczpospolita','https://rp.pl/','The London-based neobank can now offer full banking services in Poland under local supervision.','cee',false,true,true, now() - interval '4 hours'),
('Czech CNB warns on crypto exposure at regional banks','Reuters','https://reuters.com/','The central bank flagged rising indirect crypto exposure at three unnamed institutions.','cee',true,false,false, now() - interval '15 minutes'),
('Romanian fintech FintechOS raises $60M Series C','Sifted','https://sifted.eu/','The core banking modernization platform will expand into Latin America.','cee',false,true,false, now() - interval '6 hours'),
('Hungary caps interchange fees for domestic cards','Portfolio.hu','https://portfolio.hu/','New MNB rules will lower interchange to 0.2% for debit and 0.3% for credit starting January.','cee',false,true,false, now() - interval '9 hours'),
('Warsaw''s Vodeno inks partnership with Aion Bank','Finextra','https://finextra.com/','The BaaS platform will power embedded lending for European corporates.','cee',false,false,false, now() - interval '2 hours'),

('BBVA and Sabadell restart merger talks','Expansión','https://expansion.com/','Spain''s second- and fourth-largest lenders re-opened conversations after regulatory shifts.','iberia',true,false,true, now() - interval '30 minutes'),
('Portugal''s Unicre launches instant SEPA for SMEs','Jornal de Negócios','https://jornaldenegocios.pt/','Real-time credit transfers now available to 40k merchant accounts.','iberia',false,true,false, now() - interval '5 hours'),
('CaixaBank rolls out generative AI advisor in 3k branches','Finextra','https://finextra.com/','The retail-facing tool answers product questions and pre-fills mortgage applications.','iberia',false,true,false, now() - interval '7 hours'),
('Spanish neobank Bnext files for insolvency','El País','https://elpais.com/','The 2017-founded challenger cited unsustainable customer acquisition costs.','iberia',false,true,false, now() - interval '11 hours'),
('Stripe expands Iberian tap-to-pay to Android','Stripe','https://stripe.com/blog','Merchants in Spain and Portugal can now accept in-person payments on Android without hardware.','iberia',false,true,false, now() - interval '4 hours'),

('Intesa Sanpaolo posts €8.5B YTD profit','Il Sole 24 Ore','https://ilsole24ore.com/','Italy''s largest bank raised its full-year guidance on higher net interest income.','italy',false,true,true, now() - interval '6 hours'),
('Nexi cuts 400 jobs in restructuring','Reuters','https://reuters.com/','The Milan-based payments firm is consolidating post-merger operations.','italy',true,false,false, now() - interval '55 minutes'),
('Satispay valued at €3B in secondary sale','Sifted','https://sifted.eu/','The Italian P2P and merchant payments app saw employee shares trade at a new high.','italy',false,true,false, now() - interval '8 hours'),
('Bank of Italy issues guidance on tokenized bonds','Milano Finanza','https://milanofinanza.it/','The BdI clarified custody and settlement expectations for tokenized fixed income.','italy',false,true,false, now() - interval '10 hours'),
('UniCredit''s BaaS platform goes live for corporate clients','Finextra','https://finextra.com/','Direct API access to accounts and payments now available to top-tier corporate treasurers.','italy',false,true,false, now() - interval '3 hours'),

('Saudi Central Bank licenses three new digital banks','Argaam','https://argaam.com/','SAMA granted licenses as part of the Vision 2030 financial services push.','mena',false,true,true, now() - interval '5 hours'),
('UAE launches Dirham stablecoin framework','Zawya','https://zawya.com/','The Central Bank of the UAE published its final rules for AED-denominated stablecoins.','mena',true,false,true, now() - interval '25 minutes'),
('Tabby raises $200M at $3.3B valuation','Bloomberg','https://bloomberg.com/','The Riyadh-based BNPL leader is expanding into Egypt and Kuwait.','mena',false,true,false, now() - interval '7 hours'),
('Egypt''s MNT-Halan hits 10M customers','Reuters','https://reuters.com/','The super-app crossed the milestone as microloan disbursement doubled YoY.','mena',false,true,false, now() - interval '9 hours'),
('Stripe launches in Kuwait and Bahrain','Stripe','https://stripe.com/blog','Local acquiring and BYOK settlement now available for merchants in both markets.','mena',false,true,false, now() - interval '4 hours'),

('EU passes Digital Euro Act','Financial Times','https://ft.com/','Parliament approved the framework establishing the retail digital euro.','global',true,false,true, now() - interval '10 minutes'),
('Fed signals rate cut in December','Wall Street Journal','https://wsj.com/','FOMC minutes point toward a 25bp cut, boosting risk assets globally.','global',false,false,true, now() - interval '2 hours'),
('Visa acquires open banking firm Featurespace','Reuters','https://reuters.com/','The $2.75B deal expands Visa''s AI fraud prevention capabilities.','global',false,false,true, now() - interval '3 hours');

-- Seed episodes for each region (today)
INSERT INTO public.episodes (region, date, audio_url, script, duration_seconds) VALUES
('nordics', CURRENT_DATE, null, 'Good morning. Today in Nordic fintech...', 272),
('benelux', CURRENT_DATE, null, 'Good morning. Today in Benelux fintech...', 258),
('cee', CURRENT_DATE, null, 'Good morning. Today in CEE fintech...', 245),
('iberia', CURRENT_DATE, null, 'Good morning. Today in Iberia fintech...', 261),
('italy', CURRENT_DATE, null, 'Good morning. Today in Italian fintech...', 240),
('mena', CURRENT_DATE, null, 'Good morning. Today in MENA fintech...', 289);
