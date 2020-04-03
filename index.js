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
var STATE_OVER = '🏁 Game Over';

var ROLE_WOLF = '🐺';
var ROLE_VILLAGER = '🤷‍♂️';
var ROLE_SEER = '👁';
var ROLE_WITCH = '🧙‍♀️';

var MIN_PLAYERS = 4;

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

  console.log('user connected', socket.id);

  var game = undefined;
  var player = undefined;
  
  socket.on('disconnect', function(){
    console.log('user disconnected', socket.id);

    player = undefined;

    if (game) {
      if (game.state == STATE_WAIT) {
        for(var x in game.players) {
          if (game.players[x].socket.id == socket.id) {
            game.players.splice(x, 1);
          }
        }
      }

      electHost(game);
      emitHostAction(game);
      broadcastPresence(game);
    }
    
    destroyEmptyGames();
  });

  socket.on('reconnect', function(){
    console.log('user reconnected', socket.id);
  });

  socket.on('newgame', function() {
    var id = generateGameId();
    socket.emit('generated', id);
  });

  socket.on('join', function(id, name) {

    id = id.trim().toLowerCase();
    name = name.trim().toLowerCase().replace(/(<([^>]+)>)/ig,"");

    if (name.length < 1 || id.length < 4) {
      console.log("Rejected join for " + name + " in " + id + ".");
      return;
    }

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
    emitHostAction(game);

    insp(games, 3);
  });

  socket.on('progress', function() {
    if (!player || !player.isHost) {
      socket.emit('cheater!');
      console.log("cheater")
      return;
    }
    progress(game);
  });

  socket.on('kill', function(index) {
    if (!player.isHost || index >= game.players.length) {
      socket.emit('cheater!');
      console.log("cheater")
      return;
    }

    game.players[index].isVictim = true;
    broadcastPresence(game);
  });

  socket.on('revive', function(index) {
    if (!player.isHost || index >= game.players.length) {
      socket.emit('cheater!');
      console.log("cheater")
      return;
    }
    game.players[index].isVictim = false;
    broadcastPresence(game);
  });
});

http.listen(3000, function(){
  console.log('listening on *:3000');
});

function findGame(id) {
  for (var x in games) {
    if (games[x].id == id) {
      return games[x];
    }
  }
  return undefined;
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
    state: STATE_WAIT
  }
  games.push(game);
  socket.emit('created');
  console.log('created:', id);
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
      player.isDead = true;
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
    var deprecatedSocket = player.socket;
    player.socket = socket;
    player.socketId = socket.id
    deprecatedSocket.emit('deprecated');
    //deprecatedSocket.disconnect();
  } else {
    player = createPlayer(name, socket);
    game.players.push(player);
  }

  return player;
}

function listPlayers(game, player) {
  var players = [];
  for (var x in game.players) {

    var reveal = undefined;
    if (player.isHost || player.isDead || game.players[x].isDead || game.state == STATE_OVER) {
      reveal = game.players[x].role;
    }

    players.push({
      iy: (game.players[x] == player),
      nm: game.players[x].name,
      cn: game.players[x].socket.connected,
      dd: game.players[x].isDead,
      vc: game.players[x].isVictim,
      hs: game.players[x].isHost,
      rv: reveal
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
  if (!game.players.length) {
    game.host = undefined;
    return;
  }
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

function broadcastState(game, winner) {

  var winner = undefined;
  if (game.state != STATE_WAIT) {
    winner = checkWinner(game);
    if (winner) {
      game.state = STATE_OVER;
    }
  }

  for (var x in game.players) {
    game.players[x].socket.emit('state', JSON.stringify({
      st: game.state,
      wn: winner
    }));
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

  insp(game, 2);
}

function progress(game) {
  switch (game.state) {
    case STATE_WAIT:
      if (game.players.length >= MIN_PLAYERS) {
        assignRoles(game);
        broadcastRoles(game);
        broadcastPresence(game);
        game.state = STATE_NIGHT;
      }
      break;
    case STATE_NIGHT:
      if(!isRoleDead(game, ROLE_SEER)) {
        game.state = STATE_SEER;
        break;
      }
    case STATE_SEER:
      game.state = STATE_WOLFS;
      break;
    case STATE_WOLFS:
      if(!isRoleDead(game, ROLE_WITCH)) {
        game.state = STATE_WITCH;
        break;
      }
    case STATE_WITCH:
      killVictims(game);
      game.state = STATE_DAY;
      break;
    case STATE_DAY:
      killVictims(game);
      game.state = STATE_NIGHT;
      break;
    case STATE_OVER:
      game.state = STATE_WAIT;
      resetGame(game);
      broadcastRoles(game);
      break;
  }

  broadcastState(game);
  emitHostAction(game);
  broadcastPresence(game);
  
  insp(game, 2);
}

function emitHostAction(game) {

  if (!game.players.length) {
    console.log("Cant emit host action without any players")
    return;
  }

  var action = '';

  switch (game.state) {
    case STATE_WAIT:
      if (game.players.length >= MIN_PLAYERS) {
        action = 'Start Game';
      }
      break;
    case STATE_NIGHT:
      if(!isRoleDead(game, ROLE_SEER)) {
        action = 'Wake up Seer';
        break;
      }
    case STATE_SEER:
      action = 'Wake up Wolfs';
      break;
    case STATE_WOLFS:
      if(!isRoleDead(game, ROLE_WITCH)) {
        action = 'Wake up Witch';
        break;
      }
    case STATE_WITCH:
      action = 'Wake up Village';
      break;
    case STATE_DAY:
      action = 'Night comes';
      break;
    case STATE_OVER:
      action = "Start a new Game"
      break;
  }

  var host = game.players[game.host];
  host.socket.emit('action', action);
}

function killVictims(game) {
  for (var x in game.players) {
    var player = game.players[x];
    if (player.isVictim) {
      player.isDead = true;
      player.isVictim = false;
    }
  }
}

function isRoleDead(game, role) {
  for (var x in game.players) {
    var player = game.players[x];
    if (player.role == role) {
      return player.isDead;
    }
  }
  return true;
}

function resetGame(game) {

  var repeaters = game.players;

  game.state = STATE_WAIT;
  game.host = undefined;
  game.players = [];

  for (var x in repeaters) {
    var repeater = repeaters[x];
    
    if (repeater.socket.connected) {
      var player = createPlayer(repeater.name, repeater.socket);
      game.players.push(player);
    }
  }

  electHost(game);
}

function createPlayer(name, socket) {
  return {
    name: name,
    isHost: false,
    role: undefined,
    isDead: false,
    isVictim: false,
    socket: socket,
    socketId: socket.id
  };
}

function checkWinner(game) {

  var goodStillAlive = false;
  var evilStillAlive = false;

  for (var x in game.players) {
    var player = game.players[x];

    if (player.isHost) {
      continue;
    }

    if (!player.isDead) {
      if (player.role == ROLE_WOLF) {
        evilStillAlive = true;
      } else {
        goodStillAlive = true;
      }
    }
  }

  if (!goodStillAlive && !evilStillAlive) {
    return "🤡";
  }

  if (goodStillAlive != evilStillAlive) {
    return evilStillAlive ? "🐺" : "🤷‍♂️";
  }
  return undefined;
}

/*
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
    })
  }
}
*/

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