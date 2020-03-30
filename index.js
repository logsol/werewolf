var app = require('express')();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var util = require('util')

var games = [];

var STATE_WAIT = '⏳ Waiting for players';
var STATE_NIGHT = '🌙 Night falls';
var STATE_SEER = '👁 Oracle time';
var STATE_WITCH = '🧙‍♀️ Potion turn';
var STATE_WOLFS = '🐺 Midnight snack';
var STATE_DAY = '☀️ Daytime';

var ROLE_WOLF = '🐺';
var ROLE_VILLAGER = '🤷‍♂️';
var ROLE_SEER = '👁';
var ROLE_WITCH = '🧙‍♀️';

// var ROLE_GIRL = '👧';
// var ROLE_ARMOR = '🏹';
// var ROLE_HUNTER = '🔫';
// var ADDON_CAPTAIN = '🎖';
// 🎬🎭🌀

app.get('/', function(req, res) {
  res.sendFile(__dirname + '/index.html');
});

app.get('/style.css', function(req, res) {
  res.sendFile(__dirname + '/style.css');
});

io.on('connection', function(socket) {

  var game = undefined;
  var player = undefined;
  
  socket.on('disconnect', function(){
    console.log('user disconnected');

    if (player && player.isHost) {
      if (!game) throw new Error('has player but no game?');
      electHost(game);
    }
    
    if (game) {
      broadcastPresence(game);
    }

    destroyEmptyGames();
  });

  socket.on('newgame', function() {
    var id = generateGameId();
    socket.emit('generated', id);
  });

  socket.on('join', function(id, name) {
    var isCreator = !findGame(id);
    game = findOrCreateGame(id, socket);
    
    player = joinGame(game, name, socket);
    if (player == game.players[0]) {
      electHost(game);
      emitHostAction(game);
    }

    if (game.state != STATE_WAIT) {
      broadcastRoles(game);
    }
    broadcastState(game);
    broadcastPresence(game);

    insp(games, 3);
  });

  socket.on('progress', function() {
    if (!player.isHost) {
      socket.emit('cheater!');
      return;
    }
    progress(game);
  });

  socket.on('kill', function(index) {
    if (!player.isHost || index >= game.players.length) {
      socket.emit('cheater!');
      return;
    }
    game.players[index].dead = true;
    broadcastPresence(game);
  });

  socket.on('revive', function(index) {
    if (!player.isHost || index >= game.players.length) {
      socket.emit('cheater!');
      return;
    }
    game.players[index].dead = false;
    broadcastPresence(game);
  });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});

function findGame(id) {
  var game;
  for (var x in games) {
    if (games[x].id == id) {
      game = games[x];
      break;
    }
  }
  return game;
}

function generateGameId() {
  var id;
  do {
    id = Math.random().toString(36).replace(/[^a-z]+/g, '');
    id = id.substr(0, 4).toUpperCase();
  } while(findGame(id));
  return id;
}

function createGame(id, socket) {
  if (!id) {
    id = generateGameId();
  }
  var game = {
    id: id, 
    players: [],
    host: undefined,
    state: STATE_WAIT,
    victim: undefined
  }
  games.push(game);
  socket.emit('created');
  console.log('created:', id)
  return game;
}

function findOrCreateGame(id, socket) {
  var game = findGame(id);
  if (!game) {
    game = createGame(id, socket);
  }

  return game;
}

function joinGame(game, name, socket) {
  var existed = !!findPlayer(game, name);
  var player = findOrCreatePlayer(game, name, socket);

  socket.emit('joined', game.id);

  if (game.state != STATE_WAIT) {
    if (!existed) {
      player.role = ROLE_VILLAGER;
      player.dead = true;
    }

  }

  console.log(name, 'joined', game.id);
  return player;
}

function findPlayer(game, name) {
  var player;
  for(var x in game.players) {
    if (game.players[x].name === name) {
      return game.players[x];
    }
  }
  return player;
}

function findOrCreatePlayer(game, name, socket) {

  var player = findPlayer(game, name);
  
  if (player) {
    var old = player.socket;
    player.socket = socket;
    old.emit('deprecated');
    old.disconnect();
  } else {
    player = {
      name: name,
      isHost: false,
      role: undefined,
      dead: false, 
      socket: socket
    }
    game.players.push(player);
  }

  return player;
}

function listPlayers(game, player) {
  var players = [];
  for (var x in game.players) {
    players.push({
      iy: (game.players[x] == player),
      nm: game.players[x].name,
      cn: game.players[x].socket.connected,
      dd: game.players[x].dead,
      hs: game.players[x].isHost,
      rv: game.players[x].dead ? game.players[x].role : undefined
    })
  }
  return players;
}

function broadcastPresence(game) {
  for (var x in game.players) {
    var player = game.players[x];
    player.socket.emit('presence', JSON.stringify(listPlayers(game, player)))
  }
}

function destroyEmptyGames() {
  for (var g in games) {
    var game = games[g];
    var isEmpty = true;

    for (var p in game.players) {
      var player = game.players[p];
      if (player.socket.connected) {
        isEmpty = false;
        break;
      }
    }
    if (isEmpty) {
      console.log("Deleting empty game " + games[g].id);
      games.splice(g, 1);
    }
  }
  insp(games, 3);
}

function electHost(game) {
  game.host = 0;
  var host = game.players[game.host];
  host.isHost = true;
  host.role = '🗣';
  host.socket.emit('host');

  // var elected = false;
  // for (var p in game.players) {
  //   var player = game.players[p];
  //   if (!elected && player.socket.connected) {
  //     player.isHost = true;
  //     player.socket.emit('host');
  //     game.host = p;
  //     elected = true;
  //   } else {
  //     player.isHost = false;
  //   }
  // }
}

// *******************  game  *********************

function broadcastState(game) {
  for (var x in game.players) {
    game.players[x].socket.emit('state', JSON.stringify(game.state))
  }
}

function broadcastRoles(game) {
  for (var x in game.players) {
    var player = game.players[x];
    player.socket.emit('role', JSON.stringify(player.role));
  }
}

function assignRoles(game) {
  var players = game.players;
  var numWolfs = Math.floor(players.length / 3);

  var shuffled = [];
  for (var x in players) {
    if (players[x].isHost) {
      continue;
    }
    shuffled.push(players[x]);
  }
  shuffle(shuffled);

  for (var x in shuffled) {
    var player = shuffled[x];
    if (x < numWolfs) {
      player.role = ROLE_WOLF;
    } else if (x == numWolfs) {
      player.role = ROLE_SEER;
    } else if (x == numWolfs + 1) {
      player.role = ROLE_WITCH;
    } else {
      player.role = ROLE_VILLAGER;
    }
  }

  broadcastRoles(game);
  insp(game, 2);
}

function progress(game) {
  var previousState = game.state;
  switch (game.state) {
    case STATE_WAIT:
      assignRoles(game);
      broadcastPresence(game);
      game.state = STATE_NIGHT;
      break;
    case STATE_NIGHT:
      game.state = STATE_SEER;
      break;
    case STATE_SEER:
      game.state = STATE_WOLFS;
      break;
    case STATE_WOLFS:
      game.state = STATE_WITCH;
      break;
    case STATE_WITCH:
      game.state = STATE_DAY;
      break;
    case STATE_DAY:
      game.state = STATE_NIGHT;
      break;
  }

  emitHostAction(game);

  if (previousState != game.state) {
    broadcastState(game);
  }
  insp(game, 2);
}

function emitHostAction(game) {
  var action;

  switch (game.state) {
    case STATE_WAIT:
      action = 'Start Game';
      break;
    case STATE_NIGHT:
      action = 'Wake up Seer';
      break;
    case STATE_SEER:
      action = 'Wake up Wolfs';
      break;
    case STATE_WOLFS:
      action = 'Wake up Witch';
      break;
    case STATE_WITCH:
      action = 'Wake up Village';
      break;
    case STATE_DAY:
      action = 'Night comes';
      break;
  }

  if (action) {
    var host = game.players[game.host];
    host.socket.emit('action', action);
  }
}

function emitWitchInfo(game) {
  var witch;
  var poisonables = [];
  for (var x in game.players) {
    var player = game.players[x];
    if (player.role == ROLE_WITCH) {
      witch = player;
      break;
    }
  }
  if (witch) {
    witch.socket.emit('witchInfo', {
      vc: game.victim
    })
  }
}

/*
function emitWolfInfo(game) {
  var wolfs = [];
  var indexes = [];
  for (var x in game.players) {
    var player = game.players[x];
    if (player.role == ROLE_WOLF) {
      wolfs.push(player);
      indexes.push(x);
    }
  }

  var selections = [];

  var wolfinfo = {
    wf: indexes,
    sl: selections
  };

  for (var x in wolfs) {
    var wolf = wolfs[x];
    wolf.socket.emit('wolfinfo', JSON.stringify(wolfinfo));
  }
}
*/

// *******************  utils  *******************

function insp (object, depth) {
  console.log(util.inspect(object, {showHidden: false, depth: depth}));
}

function shuffle(array) {
  var currentIndex = array.length, temporaryValue, randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}