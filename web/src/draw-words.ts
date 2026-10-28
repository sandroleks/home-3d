/** The words to draw (draw and guess, the Sala TV): simple, drawable English nouns, lowercase, one or two words. */
export const DRAW_WORDS: readonly string[] = [
  // animals
  'cat', 'dog', 'horse', 'cow', 'pig', 'sheep', 'goat', 'chicken', 'duck', 'rabbit', 'mouse', 'frog', 'snake',
  'turtle', 'fish', 'shark', 'whale', 'dolphin', 'octopus', 'crab', 'lobster', 'jellyfish', 'starfish', 'snail',
  'bee', 'butterfly', 'spider', 'ant', 'ladybug', 'owl', 'eagle', 'parrot', 'penguin', 'flamingo', 'swan', 'peacock',
  'bat', 'bear', 'panda', 'lion', 'tiger', 'zebra', 'giraffe', 'elephant', 'monkey', 'gorilla', 'kangaroo', 'koala',
  'camel', 'hippo', 'rhino', 'crocodile', 'fox', 'wolf', 'deer', 'squirrel', 'hedgehog', 'seal', 'polar bear',
  'dinosaur', 'unicorn', 'dragon', 'mermaid', 'worm', 'caterpillar', 'dragonfly', 'mosquito', 'llama',
  // food
  'apple', 'banana', 'cherry', 'grapes', 'lemon', 'orange', 'pear', 'pineapple', 'strawberry', 'watermelon',
  'carrot', 'corn', 'mushroom', 'potato', 'tomato', 'broccoli', 'pumpkin', 'onion', 'bread', 'cheese', 'egg',
  'pizza', 'hamburger', 'hot dog', 'sandwich', 'taco', 'sushi', 'pancake', 'cake', 'cupcake', 'cookie', 'donut',
  'ice cream', 'popcorn', 'candy', 'lollipop', 'chocolate', 'pie', 'spaghetti', 'soup', 'sausage', 'pretzel',
  'croissant', 'avocado', 'coconut', 'peanut', 'milkshake', 'birthday cake', 'fried egg',
  // at home
  'chair', 'table', 'bed', 'sofa', 'lamp', 'clock', 'door', 'window', 'stairs', 'bathtub', 'toilet', 'shower',
  'sink', 'mirror', 'toothbrush', 'toothpaste', 'comb', 'towel', 'pillow', 'blanket', 'candle', 'vase', 'bookshelf',
  'fridge', 'oven', 'kettle', 'teapot', 'cup', 'mug', 'plate', 'fork', 'knife', 'spoon', 'bowl', 'frying pan',
  'bottle', 'key', 'lock', 'broom', 'bucket', 'ladder', 'hammer', 'saw', 'screwdriver', 'nail', 'scissors',
  'umbrella', 'wallet', 'backpack', 'suitcase', 'basket', 'calendar', 'alarm clock', 'television', 'remote control',
  'telephone', 'computer', 'laptop', 'keyboard', 'headphones', 'camera', 'light bulb', 'battery', 'washing machine',
  'vacuum cleaner', 'iron', 'sponge', 'soap', 'hanger', 'curtain', 'fan', 'doorbell', 'chimney', 'mailbox',
  // clothes
  'hat', 'crown', 'glasses', 'sunglasses', 'shirt', 'dress', 'skirt', 'trousers', 'sock', 'shoe', 'boot', 'glove',
  'scarf', 'tie', 'belt', 'jacket', 'ring', 'necklace', 'watch', 'bow tie', 'button',
  // getting about
  'car', 'bus', 'train', 'bicycle', 'motorcycle', 'scooter', 'truck', 'tractor', 'fire truck', 'ambulance', 'taxi',
  'airplane', 'helicopter', 'rocket', 'boat', 'ship', 'sailboat', 'submarine', 'canoe', 'airship', 'skateboard',
  'roller skate', 'traffic light', 'parachute',
  // outdoors
  'sun', 'moon', 'star', 'cloud', 'rainbow', 'lightning', 'tornado', 'volcano', 'mountain', 'island', 'beach',
  'wave', 'river', 'waterfall', 'desert', 'cactus', 'tree', 'palm tree', 'flower', 'rose', 'sunflower', 'tulip',
  'leaf', 'cave', 'iceberg', 'planet', 'comet', 'fire', 'campfire', 'snowflake',
  // buildings
  'house', 'castle', 'tent', 'igloo', 'lighthouse', 'bridge', 'windmill', 'barn', 'pyramid', 'skyscraper',
  'fountain', 'treehouse',
  // play and music
  'ball', 'football', 'basketball', 'tennis racket', 'baseball bat', 'hockey stick', 'trophy', 'medal', 'kite',
  'balloon', 'puzzle', 'dice', 'teddy bear', 'doll', 'robot', 'drum', 'guitar', 'piano', 'violin', 'trumpet', 'harp',
  'microphone', 'whistle', 'snowman', 'sandcastle', 'swing',
  // things
  'book', 'pencil', 'crayon', 'paintbrush', 'envelope', 'map', 'globe', 'compass', 'magnet', 'magnifying glass',
  'telescope', 'microscope', 'flashlight', 'anchor', 'sword', 'shield', 'arrow', 'axe', 'shovel', 'rake',
  'wheelbarrow', 'watering can', 'bell', 'flag', 'gift', 'heart', 'diamond', 'coin', 'piggy bank', 'treasure chest',
  'ghost', 'skeleton', 'skull', 'witch', 'pirate', 'alien', 'angel', 'vampire', 'mummy',
  // the body
  'eye', 'ear', 'nose', 'mouth', 'hand', 'foot', 'tooth', 'brain', 'bone',
];

/** `n` different words to choose from, none of them `used` already in the game; fewer if the list runs out. `rand`
 * returns [0, 1). */
export function pickChoices(rand: () => number, used: readonly string[], n = 3, words: readonly string[] = DRAW_WORDS): string[] {
  const free = words.filter((w) => !used.includes(w));
  const out: string[] = [];
  while (out.length < n && free.length) out.push(...free.splice(Math.min(free.length - 1, Math.floor(rand() * free.length)), 1));
  return out;
}
