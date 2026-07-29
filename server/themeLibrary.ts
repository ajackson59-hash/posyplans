// Curated party-theme idea library. Each entry gives ready-to-use suggestions
// (palette, menu, décor/shopping, day-of timeline moments, and a budget tip)
// for a popular party theme, so a host typing "golf" or "hole in one" gets
// specific, usable ideas instead of a blank page — turning the intuitive goal
// ("what if my 1-year-old's theme is a hole-in-one golf party?") into a
// concrete plan across the tools that already exist in the app.

export interface ThemeMenuIdea {
  course: string;
  itemName: string;
  notes?: string;
}

export interface ThemeShoppingIdea {
  category: string;
  itemName: string;
}

export interface ThemeTimelineIdea {
  time: string;
  title: string;
}

export interface ThemeSuggestion {
  theme: string; // the matched/generated theme label
  source: "curated" | "ai";
  paletteColors: string[]; // hex codes
  menuIdeas: ThemeMenuIdea[];
  shoppingIdeas: ThemeShoppingIdea[];
  timelineIdeas: ThemeTimelineIdea[];
  budgetTip: string;
  resourceUrl: string;
}

interface ThemeLibraryEntry {
  label: string;
  keywords: string[];
  paletteColors: string[];
  menuIdeas: ThemeMenuIdea[];
  shoppingIdeas: ThemeShoppingIdea[];
  timelineIdeas: ThemeTimelineIdea[];
  budgetTip: string;
}

export const THEME_LIBRARY: ThemeLibraryEntry[] = [
  {
    label: "Golf / Hole in One",
    keywords: ["golf", "hole in one", "hole-in-one", "putt", "putting", "fairway", "tee time", "9 iron"],
    paletteColors: ["#2F5233", "#FFFFFF", "#C9A227", "#8B7355"],
    menuIdeas: [
      { course: "Appetizers", itemName: "Mini corn dogs (\"tee-time bites\")" },
      { course: "Sides", itemName: "Melon-ball fruit cups styled as golf balls" },
      { course: "Cake", itemName: "White dimpled \"golf ball\" cake or cake pops" },
      { course: "Main Course", itemName: "Build-your-own \"sand trap\" nacho bar" },
      { course: "Drinks & Bar", itemName: "\"Hole-in-one\" lemonade punch" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Mini golf flags for centerpieces" },
      { category: "Décor", itemName: "Artificial turf table runner" },
      { category: "Décor", itemName: "White balloons with black dimple dots (golf balls)" },
      { category: "Entertainment", itemName: "Kiddie putting green mat or rental" },
      { category: "Guest Supplies", itemName: "Foam golf visors as party favors" },
      { category: "Take-Home Items", itemName: "Personalized golf-tee favor bags" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Putting contest / mini-golf activity" },
      { time: "+45 min", title: "Cake smash — golf ball cake" },
      { time: "+1 hr", title: "Photo op at \"19th hole\" backdrop" },
      { time: "+1.5 hr", title: "Award the \"MVP Golfer\" trophy to the birthday kid" },
    ],
    budgetTip:
      "Skip renting an actual golf-course venue — a backyard putting mat plus a turf table runner gets 90% of the visual impact for a fraction of the cost.",
  },
  {
    label: "Superhero",
    keywords: ["superhero", "super hero", "avengers", "marvel", "batman", "justice league", "comic book"],
    paletteColors: ["#D62828", "#003049", "#F7B801", "#FFFFFF"],
    menuIdeas: [
      { course: "Appetizers", itemName: "\"Kryptonite\" green punch and popcorn cups" },
      { course: "Main Course", itemName: "Sliders wrapped in \"superhero cape\" foil" },
      { course: "Cake", itemName: "Comic-book \"POW!\" burst cake or cupcakes" },
      { course: "Dessert", itemName: "Star-shaped fruit skewers" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "City skyline backdrop or banner" },
      { category: "Décor", itemName: "Comic-book \"POW/BAM\" balloon cluster" },
      { category: "Entertainment", itemName: "Superhero cape + mask craft station" },
      { category: "Guest Supplies", itemName: "Kid-size capes as favors" },
      { category: "Take-Home Items", itemName: "Mini comic books or superhero stickers" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Hero name badge + cape craft station" },
      { time: "+30 min", title: "\"Save the city\" obstacle course / games" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Group hero photo" },
    ],
    budgetTip: "A DIY cape-and-mask craft table doubles as décor and activity, cutting the need for separate entertainment and favors.",
  },
  {
    label: "Princess / Fairy Tale",
    keywords: ["princess", "fairy tale", "fairytale", "disney princess", "castle", "royal ball"],
    paletteColors: ["#F7CAD0", "#C9A9E9", "#FFFFFF", "#D4AF37"],
    menuIdeas: [
      { course: "Cake", itemName: "Castle-shaped or tiered pastel cake" },
      { course: "Dessert", itemName: "\"Royal jewel\" fruit tart bites" },
      { course: "Drinks & Bar", itemName: "Sparkling pink \"magic potion\" lemonade" },
      { course: "Appetizers", itemName: "Crown-shaped sandwich cutouts" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Tulle backdrop or castle photo backdrop" },
      { category: "Décor", itemName: "Gold balloon crown garland" },
      { category: "Entertainment", itemName: "Tiara + wand decorating station" },
      { category: "Take-Home Items", itemName: "Tiaras or wands as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Royal welcome / tiara handout" },
      { time: "+30 min", title: "Tiara & wand decorating craft" },
      { time: "+1 hr", title: "Cake & \"royal toast\"" },
      { time: "End time", title: "Group photo on the castle backdrop" },
    ],
    budgetTip: "One tulle or fabric backdrop panel does double duty as décor and the photo-op — no separate backdrop rental needed.",
  },
  {
    label: "Under the Sea / Mermaid",
    keywords: ["mermaid", "under the sea", "ocean", "sea creature", "little mermaid"],
    paletteColors: ["#00B4D8", "#90E0EF", "#CAF0F8", "#F4A5C0"],
    menuIdeas: [
      { course: "Cake", itemName: "Mermaid tail or ombre-blue wave cake" },
      { course: "Appetizers", itemName: "Goldfish crackers in sand-bucket cups" },
      { course: "Dessert", itemName: "Blue jello \"ocean\" cups with gummy fish" },
      { course: "Drinks & Bar", itemName: "Blue lemonade \"mermaid water\"" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Blue/teal balloon arch with paper fish" },
      { category: "Décor", itemName: "Fishnet or streamer backdrop" },
      { category: "Guest Supplies", itemName: "Mermaid tail blankets or shell hair clips" },
      { category: "Take-Home Items", itemName: "Shell-shaped soaps or seashell favor bags" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "\"Mermaid cove\" photo op" },
      { time: "+30 min", title: "Treasure hunt / pearl scoop game" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Bubble send-off" },
    ],
    budgetTip: "Balloon arches in 2-3 shades of blue read as \"ocean\" instantly — cheaper than full fabric draping or a rented backdrop.",
  },
  {
    label: "Dinosaur",
    keywords: ["dinosaur", "dino", "jurassic", "t-rex", "trex"],
    paletteColors: ["#4C6444", "#8AA624", "#D9A24A", "#3D2B1F"],
    menuIdeas: [
      { course: "Main Course", itemName: "\"Dino nugget\" chicken bites" },
      { course: "Cake", itemName: "\"Dino egg\" cake or cupcakes with candy shell" },
      { course: "Dessert", itemName: "Volcano fruit display (pineapple \"lava\")" },
      { course: "Drinks & Bar", itemName: "Green \"dino swamp juice\"" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Jungle leaf garland / \"prehistoric jungle\" backdrop" },
      { category: "Décor", itemName: "Inflatable dinosaurs as table centerpieces" },
      { category: "Entertainment", itemName: "\"Dino egg\" excavation activity (toys frozen in ice)" },
      { category: "Take-Home Items", itemName: "Mini dinosaur figures as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Dino egg dig / excavation activity" },
      { time: "+30 min", title: "\"Dino stomp\" freeze dance or games" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Fossil dig favor handout" },
    ],
    budgetTip: "Freezing small dino toys in ice-cube trays for a \"fossil excavation\" is a near-free activity that also works as a keepsake favor.",
  },
  {
    label: "Safari / Jungle",
    keywords: ["safari", "jungle", "wild one", "zoo", "wild animal"],
    paletteColors: ["#6B8E23", "#D2B48C", "#8B4513", "#F4A300"],
    menuIdeas: [
      { course: "Appetizers", itemName: "\"Trail mix\" snack cups" },
      { course: "Cake", itemName: "\"Wild One\" jungle-leaf cake" },
      { course: "Dessert", itemName: "Animal cracker cupcake toppers" },
      { course: "Drinks & Bar", itemName: "Tropical punch \"jungle juice\"" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Palm leaf garland / jungle backdrop" },
      { category: "Décor", itemName: "Plush safari animals as table accents" },
      { category: "Guest Supplies", itemName: "Safari hats or animal print favors" },
      { category: "Take-Home Items", itemName: "Mini binoculars or animal figurines" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "\"Animal spotting\" scavenger hunt" },
      { time: "+30 min", title: "Face painting or safari hat craft" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "End time", title: "Group photo with plush animals" },
    ],
    budgetTip: "Rent or borrow a few oversized plush safari animals for photo props instead of buying full jungle décor sets.",
  },
  {
    label: "Space / Astronaut",
    keywords: ["space", "astronaut", "rocket", "galaxy", "outer space", "planets"],
    paletteColors: ["#0B132B", "#5BC0BE", "#C9A0DC", "#FFFFFF"],
    menuIdeas: [
      { course: "Cake", itemName: "Galaxy-swirl cake or \"planet\" cake pops" },
      { course: "Appetizers", itemName: "\"Moon rock\" popcorn (white chocolate drizzle)" },
      { course: "Dessert", itemName: "Star-shaped cookies" },
      { course: "Drinks & Bar", itemName: "\"Rocket fuel\" blue punch" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Black balloon arch with silver star garland" },
      { category: "Décor", itemName: "Hanging planet mobiles" },
      { category: "Entertainment", itemName: "\"Rocket launch\" build-and-shoot activity" },
      { category: "Take-Home Items", itemName: "Astronaut helmet stickers or glow sticks" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "\"Mission briefing\" welcome / name badges" },
      { time: "+30 min", title: "Build-a-rocket craft or launch activity" },
      { time: "+1 hr", title: "Cake & \"blast off\" countdown" },
      { time: "After", title: "Glow-stick send-off (if evening)" },
    ],
    budgetTip: "A black balloon arch with a few silver star cutouts creates a convincing night-sky backdrop without buying a printed mural.",
  },
  {
    label: "Unicorn & Rainbow",
    keywords: ["unicorn", "rainbow party", "pastel magic"],
    paletteColors: ["#F7CAD0", "#B5EAD7", "#C9A9E9", "#FFF6B7"],
    menuIdeas: [
      { course: "Cake", itemName: "Rainbow layer cake with unicorn horn topper" },
      { course: "Dessert", itemName: "Pastel macarons or unicorn-poop cake pops" },
      { course: "Drinks & Bar", itemName: "Color-changing \"magic\" lemonade" },
      { course: "Appetizers", itemName: "Fruit rainbow skewers" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Pastel balloon garland with gold horn cutouts" },
      { category: "Décor", itemName: "Unicorn photo backdrop" },
      { category: "Guest Supplies", itemName: "Unicorn headbands as favors" },
      { category: "Take-Home Items", itemName: "Glitter wands or rainbow candy bags" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Unicorn headband decorating station" },
      { time: "+30 min", title: "Rainbow craft or games" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "End time", title: "Group photo at the unicorn backdrop" },
    ],
    budgetTip: "Fruit rainbow skewers cover the \"colorful dessert\" impulse at grocery-store prices instead of a custom bakery order.",
  },
  {
    label: "Construction / Dump Truck",
    keywords: ["construction", "dump truck", "builder", "digger", "excavator"],
    paletteColors: ["#F7B801", "#E85D04", "#3D3D3D", "#FFFFFF"],
    menuIdeas: [
      { course: "Main Course", itemName: "\"Dirt cup\" pudding with crushed cookies" },
      { course: "Cake", itemName: "Construction-site sheet cake with toy trucks" },
      { course: "Appetizers", itemName: "\"Gravel\" trail mix cups" },
      { course: "Drinks & Bar", itemName: "Orange \"caution cone\" punch" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Caution tape streamers and cone centerpieces" },
      { category: "Décor", itemName: "Toy dump trucks as table accents" },
      { category: "Entertainment", itemName: "Sandbox or kinetic-sand digging station" },
      { category: "Take-Home Items", itemName: "Mini hard hats or toy trucks as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Hard hat handout / \"job site\" check-in" },
      { time: "+30 min", title: "Sandbox digging / building activity" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Toy truck favor pickup" },
    ],
    budgetTip: "A kiddie sandbox with a few dollar-store diggers keeps kids occupied for the whole party — cheaper than most rented entertainment.",
  },
  {
    label: "Farm / Barnyard",
    keywords: ["farm", "barnyard", "tractor", "barn party"],
    paletteColors: ["#7A5C3E", "#E4572E", "#F3D34A", "#FFFFFF"],
    menuIdeas: [
      { course: "Main Course", itemName: "\"Farm fresh\" mini corn on the cob bites" },
      { course: "Cake", itemName: "Red barn cake with animal cracker toppers" },
      { course: "Appetizers", itemName: "\"Chicken feed\" trail mix" },
      { course: "Drinks & Bar", itemName: "Farm-stand lemonade" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Red gingham tablecloths and hay bale seating" },
      { category: "Décor", itemName: "Barn/farm animal cutout banner" },
      { category: "Entertainment", itemName: "Petting-zoo rental or farm animal photo props" },
      { category: "Take-Home Items", itemName: "Mini animal figurines as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "\"Farm check-in\" with animal photo props" },
      { time: "+30 min", title: "Barnyard games (ring toss, egg-and-spoon)" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "End time", title: "Animal cracker favor handout" },
    ],
    budgetTip: "Gingham tablecloths and hay bales (often free/cheap to rent from a garden center) do most of the visual work for very little cost.",
  },
  {
    label: "Sports (All-Star)",
    keywords: ["sports party", "all-star", "baseball", "football", "basketball", "soccer party", "mvp"],
    paletteColors: ["#1D3557", "#E63946", "#F1FAEE", "#FFB703"],
    menuIdeas: [
      { course: "Main Course", itemName: "Ballpark hot dogs & pretzels" },
      { course: "Cake", itemName: "Sports-ball themed cake (baseball/basketball/soccer)" },
      { course: "Appetizers", itemName: "Nacho bar in mini helmet bowls" },
      { course: "Drinks & Bar", itemName: "Team-color punch" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Pennant banner in team colors" },
      { category: "Décor", itemName: "Sports ball balloon cluster" },
      { category: "Entertainment", itemName: "Mini hoop, ball toss, or backyard relay games" },
      { category: "Take-Home Items", itemName: "MVP medals or mini trophies as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Team jersey / number handout" },
      { time: "+30 min", title: "Backyard relay games or ball toss" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "MVP trophy award to the birthday kid" },
    ],
    budgetTip: "Dollar-store medals for every kid (not just \"winners\") let you skip pricier trophies while still hitting the awards moment.",
  },
  {
    label: "Beach / Tropical Luau",
    keywords: ["beach party", "tropical", "luau", "hawaiian", "tiki"],
    paletteColors: ["#00A896", "#F6BD60", "#F28482", "#FFFFFF"],
    menuIdeas: [
      { course: "Appetizers", itemName: "Pineapple & fruit skewers" },
      { course: "Cake", itemName: "Coconut or pineapple-upside-down cake" },
      { course: "Main Course", itemName: "Grilled skewers or a build-your-own taco bar" },
      { course: "Drinks & Bar", itemName: "Virgin piña colada or tropical punch" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Tiki torches and grass table skirting" },
      { category: "Décor", itemName: "Tropical flower garland" },
      { category: "Guest Supplies", itemName: "Leis for every guest" },
      { category: "Take-Home Items", itemName: "Mini sunglasses or beach-ball favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Lei greeting at check-in" },
      { time: "+30 min", title: "Limbo or hula-hoop contest" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Photo op with tiki backdrop" },
    ],
    budgetTip: "A pack of leis for every guest (a few dollars total) instantly signals \"luau\" — often more cost-effective than full tiki-bar rentals.",
  },
  {
    label: "Rustic Farmhouse",
    keywords: ["rustic farmhouse", "rustic chic", "barn wedding", "country chic"],
    paletteColors: ["#7C6A58", "#EDE6DB", "#A9927D", "#5B4636"],
    menuIdeas: [
      { course: "Main Course", itemName: "Comfort-food buffet (mac & cheese, pulled pork)" },
      { course: "Dessert", itemName: "Mason-jar desserts (trifle, cobbler)" },
      { course: "Cake", itemName: "Naked or semi-naked cake with greenery" },
      { course: "Drinks & Bar", itemName: "Mason-jar lemonade station" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Wooden crates and mason jar centerpieces" },
      { category: "Décor", itemName: "Burlap table runners" },
      { category: "Décor", itemName: "Chalkboard welcome/menu signs" },
      { category: "Take-Home Items", itemName: "Small potted succulents as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Welcome + chalkboard signage greeting" },
      { time: "+1 hr", title: "Toasts / speeches" },
      { time: "+1.5 hr", title: "Cake cutting" },
      { time: "End time", title: "Favor table pickup" },
    ],
    budgetTip: "Mason jars double as centerpieces, drinkware, and dessert cups — buy one batch and reuse it across three parts of the setup.",
  },
  {
    label: "Enchanted Garden / Floral",
    keywords: ["enchanted garden", "floral party", "botanical", "greenery theme", "garden party", "enchanted forest"],
    paletteColors: ["#5F7161", "#EEE3CB", "#D8A48F", "#FFFFFF"],
    menuIdeas: [
      { course: "Appetizers", itemName: "Herb & flower-garnished finger sandwiches" },
      { course: "Cake", itemName: "Greenery & edible-flower cake" },
      { course: "Dessert", itemName: "Lavender or floral shortbread cookies" },
      { course: "Drinks & Bar", itemName: "Sparkling herb-infused lemonade" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Eucalyptus/greenery garland" },
      { category: "Décor", itemName: "Fresh or faux flower centerpieces" },
      { category: "Décor", itemName: "Botanical-print welcome sign" },
      { category: "Take-Home Items", itemName: "Seed packets or small potted plants as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Garden welcome / flower crown station" },
      { time: "+45 min", title: "Mingling & photos among the greenery" },
      { time: "+1.5 hr", title: "Cake & toast" },
      { time: "End time", title: "Seed-packet favor handout" },
    ],
    budgetTip: "Faux eucalyptus garland is reusable and often cheaper long-term than fresh greenery, especially for a multi-hour outdoor event.",
  },
  {
    label: "Western / Cowboy",
    keywords: ["western party", "cowboy", "cowgirl", "rodeo", "wild west"],
    paletteColors: ["#8B4513", "#DEB887", "#B22222", "#F5DEB3"],
    menuIdeas: [
      { course: "Main Course", itemName: "BBQ sliders & baked beans" },
      { course: "Cake", itemName: "\"Wanted poster\" or horseshoe-topped cake" },
      { course: "Appetizers", itemName: "Cornbread bites" },
      { course: "Drinks & Bar", itemName: "Root beer float bar" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Bandana table runners and hay bale seating" },
      { category: "Décor", itemName: "Wagon wheel or horseshoe accents" },
      { category: "Guest Supplies", itemName: "Cowboy hats and bandanas for guests" },
      { category: "Take-Home Items", itemName: "Sheriff badge favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Hat & bandana handout at check-in" },
      { time: "+30 min", title: "Horseshoe toss or lasso games" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Sheriff badge favor handout" },
    ],
    budgetTip: "Bandanas ($1-2 each in bulk) work as table runners, guest favors, and photo props — one purchase covers three needs.",
  },
  {
    label: "Vintage / Retro",
    keywords: ["vintage party", "retro party", "50s party", "sock hop", "throwback"],
    paletteColors: ["#EF476F", "#FFD166", "#06D6A0", "#FFFFFF"],
    menuIdeas: [
      { course: "Drinks & Bar", itemName: "Root beer floats / classic diner sodas" },
      { course: "Cake", itemName: "Checkerboard or record-shaped cake" },
      { course: "Dessert", itemName: "Retro milkshake shooters" },
      { course: "Main Course", itemName: "Classic diner sliders & fries" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Checkerboard table runner" },
      { category: "Décor", itemName: "Record-sleeve or jukebox photo props" },
      { category: "Entertainment", itemName: "Retro playlist / dance-off contest" },
      { category: "Take-Home Items", itemName: "Retro candy favor bags" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Sock-hop welcome / photo booth with props" },
      { time: "+30 min", title: "Dance-off or trivia contest" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Retro candy favor handout" },
    ],
    budgetTip: "A curated retro playlist and a few photo props (sunglasses, records) create the era without renting themed furniture.",
  },
  {
    label: "Boho Chic",
    keywords: ["boho", "bohemian", "macrame theme", "desert chic"],
    paletteColors: ["#C97C5D", "#E8C4A0", "#7D8471", "#F4EAD5"],
    menuIdeas: [
      { course: "Appetizers", itemName: "Grazing/charcuterie board" },
      { course: "Cake", itemName: "Terracotta-toned naked cake with dried flowers" },
      { course: "Dessert", itemName: "Dried fruit & nut dessert bar" },
      { course: "Drinks & Bar", itemName: "Herb-infused sparkling water bar" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Macrame wall hangings or backdrop" },
      { category: "Décor", itemName: "Pampas grass or dried floral arrangements" },
      { category: "Décor", itemName: "Hand-lettered welcome sign" },
      { category: "Take-Home Items", itemName: "Dried flower bundles as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Welcome + grazing board mingling" },
      { time: "+1 hr", title: "Toasts or a shared activity (photo booth)" },
      { time: "+1.5 hr", title: "Cake & candles" },
      { time: "End time", title: "Favor bundle pickup" },
    ],
    budgetTip: "Dried florals (pampas grass, eucalyptus) don't wilt, so you can buy them ahead of time and reuse leftovers as favors.",
  },
  {
    label: "Circus / Carnival",
    keywords: ["circus", "carnival", "big top", "county fair", "carnival theme"],
    paletteColors: ["#E63946", "#F1C453", "#1D3557", "#FFFFFF"],
    menuIdeas: [
      { course: "Appetizers", itemName: "Popcorn & cotton candy station" },
      { course: "Cake", itemName: "Big-top striped tent cake" },
      { course: "Dessert", itemName: "Candy apples or churro bites" },
      { course: "Drinks & Bar", itemName: "Circus punch (rainbow sherbet float)" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Red & white striped tent backdrop or banner" },
      { category: "Décor", itemName: "Balloon animal accents" },
      { category: "Entertainment", itemName: "Carnival games (ring toss, bean bag toss)" },
      { category: "Take-Home Items", itemName: "Ticket-stub favor bags with candy" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "\"Ticket booth\" check-in with wristbands" },
      { time: "+30 min", title: "Carnival games rotation" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Cotton candy send-off" },
    ],
    budgetTip: "A few classic carnival games (ring toss, bean bag toss) built from cardboard cost almost nothing and keep kids busy for an hour.",
  },
  {
    label: "Casino Night",
    keywords: ["casino night", "casino party", "vegas theme", "poker night", "black jack party"],
    paletteColors: ["#0B0C10", "#C5A059", "#8B0000", "#FFFFFF"],
    menuIdeas: [
      { course: "Appetizers", itemName: "Passed hors d'oeuvres (shrimp cocktail, sliders)" },
      { course: "Drinks & Bar", itemName: "Signature cocktail bar" },
      { course: "Cake", itemName: "Playing-card or dice-topped cake" },
      { course: "Dessert", itemName: "Chocolate poker chips" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Poker chip & card table centerpieces" },
      { category: "Décor", itemName: "Black, gold, and red balloon accents" },
      { category: "Entertainment", itemName: "Rented card/roulette tables or games" },
      { category: "Take-Home Items", itemName: "Deck of cards or dice favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "\"Welcome to Vegas\" check-in with play money" },
      { time: "+30 min", title: "Casino games rotation" },
      { time: "+1.5 hr", title: "Prize raffle for top chip counts" },
      { time: "End time", title: "Favor handout" },
    ],
    budgetTip: "Renting 1-2 tables (blackjack, poker) instead of a full casino package covers the theme for a fraction of the price.",
  },
  {
    label: "Movie Night / Hollywood",
    keywords: ["movie night", "hollywood theme", "red carpet", "cinema party", "movie premiere"],
    paletteColors: ["#000000", "#D4AF37", "#FFFFFF", "#8B0000"],
    menuIdeas: [
      { course: "Appetizers", itemName: "Popcorn bar with flavor toppings" },
      { course: "Dessert", itemName: "Movie-candy dessert table" },
      { course: "Cake", itemName: "Film-reel or clapperboard cake" },
      { course: "Drinks & Bar", itemName: "Mocktail \"movie premiere\" punch" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Red carpet runner and gold stanchions/rope" },
      { category: "Décor", itemName: "Star-shaped balloon garland" },
      { category: "Entertainment", itemName: "Outdoor projector & screen setup" },
      { category: "Take-Home Items", itemName: "Mini popcorn boxes as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Red carpet photo entrance" },
      { time: "+30 min", title: "Popcorn bar mingling" },
      { time: "+1 hr", title: "Feature film screening" },
      { time: "After", title: "Cake & candid awards (\"Best Dressed\", etc.)" },
    ],
    budgetTip: "A red fabric runner (a few dollars per yard) plus a projector you already own gets 90% of the \"Hollywood premiere\" feel.",
  },
  {
    label: "Holiday / Winter Wonderland",
    keywords: ["christmas party", "winter wonderland", "holiday party", "xmas party", "christmas theme"],
    paletteColors: ["#1B4332", "#FFFFFF", "#B22222", "#D4AF37"],
    menuIdeas: [
      { course: "Dessert", itemName: "Decorate-your-own sugar cookies" },
      { course: "Cake", itemName: "Snowflake or \"snow globe\" cake" },
      { course: "Drinks & Bar", itemName: "Hot cocoa bar with toppings" },
      { course: "Appetizers", itemName: "Charcuterie tree/wreath board" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "String lights and faux snow/garland" },
      { category: "Décor", itemName: "Ornament centerpieces" },
      { category: "Entertainment", itemName: "Cookie decorating station" },
      { category: "Take-Home Items", itemName: "Mini ornaments as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Hot cocoa bar welcome" },
      { time: "+30 min", title: "Cookie decorating station" },
      { time: "+1 hr", title: "Gift exchange or Secret Santa" },
      { time: "End time", title: "Ornament favor handout" },
    ],
    budgetTip: "String lights are the highest-impact, lowest-cost décor item for this theme — buy warm-white lights you can reuse every year.",
  },
  {
    label: "Halloween / Spooky",
    keywords: ["halloween party", "spooky theme", "haunted house", "costume party"],
    paletteColors: ["#FF6B35", "#000000", "#6A0572", "#FFFFFF"],
    menuIdeas: [
      { course: "Dessert", itemName: "\"Mummy\" dipped pretzels / spider cupcakes" },
      { course: "Cake", itemName: "Black & orange \"graveyard\" cake" },
      { course: "Drinks & Bar", itemName: "\"Witch's brew\" green punch" },
      { course: "Appetizers", itemName: "\"Eyeball\" caprese skewers" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Cobweb and string light décor" },
      { category: "Décor", itemName: "Pumpkin or skull centerpieces" },
      { category: "Entertainment", itemName: "Costume contest or pumpkin decorating station" },
      { category: "Take-Home Items", itemName: "Halloween candy favor bags" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Costume check-in / photo booth" },
      { time: "+30 min", title: "Pumpkin decorating or costume contest" },
      { time: "+1 hr", title: "Cake & candles" },
      { time: "After", title: "Trick-or-treat favor handout" },
    ],
    budgetTip: "Fake cobwebs and orange string lights transform a plain room for under $20 — the highest-impact décor per dollar for this theme.",
  },
  {
    label: "Tea Party",
    keywords: ["tea party", "alice in wonderland", "high tea", "mad hatter"],
    paletteColors: ["#EAD7D1", "#B3CDE0", "#F1E3D3", "#8E7C93"],
    menuIdeas: [
      { course: "Appetizers", itemName: "Finger sandwiches (cucumber, egg salad)" },
      { course: "Dessert", itemName: "Mini scones with jam and cream" },
      { course: "Cake", itemName: "Teacup-shaped or floral-topped cake" },
      { course: "Drinks & Bar", itemName: "Assorted teas / pink lemonade for kids" },
    ],
    shoppingIdeas: [
      { category: "Décor", itemName: "Mismatched teacups and floral tablecloths" },
      { category: "Décor", itemName: "Tiered dessert stands" },
      { category: "Entertainment", itemName: "Hat or fascinator decorating station" },
      { category: "Take-Home Items", itemName: "Tea bags or small teacups as favors" },
    ],
    timelineIdeas: [
      { time: "Start time", title: "Tea pouring / welcome toast" },
      { time: "+30 min", title: "Hat decorating station" },
      { time: "+1 hr", title: "Scones, sandwiches & cake service" },
      { time: "End time", title: "Favor teacup handout" },
    ],
    budgetTip: "Thrift-store mismatched teacups and saucers are cheaper than a matching set and read as more charmingly \"tea party\" than uniform dishware.",
  },
];

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
}

export function matchThemeLibrary(rawTheme: string): ThemeLibraryEntry | null {
  const normalized = normalize(rawTheme);
  if (!normalized) return null;
  let best: ThemeLibraryEntry | null = null;
  let bestScore = 0;
  for (const entry of THEME_LIBRARY) {
    for (const keyword of entry.keywords) {
      const nk = normalize(keyword);
      if (normalized.includes(nk) || nk.includes(normalized)) {
        // Prefer the longest matching keyword — more specific matches win
        // (e.g. "hole in one" over a generic single-word overlap).
        if (nk.length > bestScore) {
          bestScore = nk.length;
          best = entry;
        }
      }
    }
  }
  return best;
}

export function buildResourceUrl(theme: string): string {
  return `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(`${theme} party ideas`)}`;
}

export function libraryEntryToSuggestion(entry: ThemeLibraryEntry, rawTheme: string): ThemeSuggestion {
  return {
    theme: entry.label,
    source: "curated",
    paletteColors: entry.paletteColors,
    menuIdeas: entry.menuIdeas,
    shoppingIdeas: entry.shoppingIdeas,
    timelineIdeas: entry.timelineIdeas,
    budgetTip: entry.budgetTip,
    resourceUrl: buildResourceUrl(rawTheme || entry.label),
  };
}
