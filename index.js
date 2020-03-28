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

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', function(socket){
  
  socket.on('disconnect', function(){
    console.log('user disconnected');
    destroyEmptyGames();
  });

  socket.on('newgame', function() {
    var id = generateGameId();
    socket.emit('generated', id);
  });

  socket.on('join', function(id, name) {
    var game = findOrCreateGame(id, socket);
    joinGame(game, name, socket);
    insp(games);
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
  findOrCreatePlayer(game, name, socket);

  socket.emit('joined', game.id);
  console.log('joined:', game.id);
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
      role: 0,
      dead: false, 
      socket: socket
    }
    game.players.push(player);
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
  insp(games);
}

function insp (object) {
  console.log(util.inspect(object, {showHidden: false, depth: 3}));
}