var app = require('express')();
var http = require('http').createServer(app);
var io = require('socket.io')(http);
var util = require('util')

var games = [];

var STATE_WAIT = 'wait';
var STATE_SLEEP = 'sleep';
var STATE_SEER = 'seer';
var STATE_WITCH = 'witch';
var STATE_WOLFS = 'wolfs';
var STATE_WAKE = 'wake';

var ROLE_WOLF = 'wolf';
var ROLE_VILLAGER = 'villager';
var ROLE_SEER = 'seer';
var ROLE_WITCH = 'witch';

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket) {

  var game = undefined;
  var player = undefined;
  
  socket.on('disconnect', function(){
    console.log('user disconnected');
    destroyEmptyGames();
    
    if (game) {
      broadcastPresence(game);
    }
  });

  socket.on('newgame', function() {
    var id = generateGameId();
    socket.emit('generated', id);
  });

  socket.on('join', function(id, name) {
    var isHost = !findGame(id);
    game = findOrCreateGame(id, socket);
    
    player = joinGame(game, name, socket);
    player.isHost = isHost;

    insp(games, 3);
  });

  socket.on('start', function() {
    if (!player.isHost) {
      socket.emit('cheater!');
      return;
    }
    if (game.state != STATE_WAIT) {
      //return;
    }
    assignRoles(game);
    progress(game, player);
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
    id = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 4).toUpperCase();
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
    state: STATE_WAIT
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
  var player = findOrCreatePlayer(game, name, socket);

  socket.emit('joined', game.id);
  console.log('joined:', game.id);

  broadcastPresence(game);
  broadcastState(game);

  return player;
}

function findOrCreatePlayer(game, name, socket) {

  var player;
  for(var x in game.players) {
    if (game.players[x].name === name) {
      player = game.players[x];
      var old = player.socket;
      player.socket = socket;
      old.emit('deprecated');
      old.disconnect();
    }
  }

  if (!player) {
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

function listPlayers(game) {
  var players = [];
  for (var x in game.players) {
    players.push({
      nm: game.players[x].name,
      cn: game.players[x].socket.connected
    })
  }
  return players;
}

function broadcastPresence(game) {
  for (var x in game.players) {
    game.players[x].socket.emit('presence', JSON.stringify(listPlayers(game)))
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

// *******************  game  *********************

function broadcastState(game) {
  for (var x in game.players) {
    game.players[x].socket.emit('state', JSON.stringify(game.state))
  }
}

function assignRoles(game) {
  var players = game.players;
  var numWolfs = Math.floor(players.length / 3);

  var shuffled = [];
  for (var x in players) {
    shuffled.push(players[x]);
  }
  shuffle(shuffled);

  for (var x in shuffled) {
    var player = shuffled[x];
    if (x < numWolfs) {
      player.role = ROLE_WOLF;
    } else if (x == numWolfs) {
      player.role = ROLE_WITCH;
    } else if (x == numWolfs + 1) {
      player.role = ROLE_SEER;
    }
  }

  insp(game, 2);
}

function progress(game, player) {
  var previousState = game.state;
  switch (game.state) {
    case STATE_WAIT:
      if (player.isHost) {
        game.state = STATE_SLEEP;
      }
      break;
  }

  if (previousState != game.state) {
    broadcastState(game);
  }
}

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