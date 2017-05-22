"use strict";
const fs = require("fs"),
  MongoClient = require("mongodb").MongoClient,
  schemaFaker = require("json-schema-faker");

function loadFixtures(fixturesPath, fixtureMap) {
  fs
    .readdirSync(fixturesPath)
    .forEach(function (fileName) {
      let fixture = require(`${fixturesPath}/${fileName}`)();
      for (let key of fixture.keys()) {
        fixtureMap.set(key, fixture.get(key));
      }
    });
}

// username:password@]host1[:port1][,host2[:port2],...[,hostN[:portN]]][/[database][?options]]
function connectionString(dbConfig) {
  const hostPortPairs = dbConfig.uris.map(function (uri) {
    return `mongodb://${uri}/${dbConfig.options.database}`;
  }).join(",");
  if (dbConfig.options.username.length > 0) {
    return `${dbConfig.options.username}:${dbConfig.options.password}@${hostPortPairs}`;
  }
  return hostPortPairs;
}

function* modelGen(schema, qty, overrides, references) {
  let x  = 0;
  if (references && !Array.isArray(references)) {
    throw new Error("External references needs to be an array of json-schemas");
  }
  try {
    while(x < qty) {
      let model = schemaFaker(schema, references);
      if (Array.isArray(overrides)) {
        let index = x;
        if (overrides.length-1 < x) {
          index = x % overrides.length;
        }
        yield Object.assign({}, model, overrides[index]);
      }
      else {
        yield Object.assign({}, model, overrides);
      }
      x++;
    }
  } catch(e) {
    throw new Error("There was a problem with the references array, make sure it contains a valid json-schemas: " +  e);
  }
}

function MongoFactory(options) {

  let fixturesPath = options.fixtures;
  let fixtureMap = new Map();
  let createdMap = new Map();
  loadFixtures(fixturesPath, fixtureMap);

  this.connection = MongoClient.connect(connectionString(options.db))
    .catch((err) => {
      throw err;
    });

  this.fixtures = function (fixtureName) {
    if (!fixtureName) {
      return fixtureMap;
    } else {
      return fixtureMap.get(fixtureName);
    }
  };

  this.saveIds = function (fixtureName) {
    return function (ids) {
      ids.forEach(function (id) {
        if (createdMap.has(fixtureName)) {
          createdMap.get(fixtureName).push(id);
        } else {
          createdMap.set(fixtureName, [id]);
        }
      });
    };
  };

  this.created = function (fixtureName) {
    if (!fixtureName) {
      return createdMap;
    } else {
      return createdMap.get(fixtureName);
    }
  };
}

MongoFactory.prototype.create = function (modelName, options, references) {
  let overrides = options || {};
  let model = modelGen(this.fixtures(modelName), 1, overrides, references).next().value;
  return this.connection
    .then((db) => {
      return db.collection(modelName).insert(model);
    })
    .then((result) => {
      this.saveIds(modelName)(result.insertedIds);
      return result.ops[0] || {};
    });
};

MongoFactory.prototype.createList = function (modelName, qty, options, references) {
  let overrides = options || {};
  let models = [];
  for (let model of modelGen(this.fixtures(modelName), qty, overrides, references)) {
    models.push(model);
  }
  return this.connection
    .then((db) => {
      return db.collection(modelName).insert(models);
    })
    .then((result) => {
      this.saveIds(modelName)(result.insertedIds);
      return result.ops;
    });
};

MongoFactory.prototype.clearAll = function () {
  let createdMap = this.created();
  let removes = [];
  return this.connection.then((db) => {
    for (let key of createdMap.keys()) {
      let query = {"_id": {"$in": createdMap.get(key)}};
      removes.push(db.collection(key).remove(query));
    }
    return Promise.all(removes);
  });
};

exports.MongoFactory = MongoFactory;
