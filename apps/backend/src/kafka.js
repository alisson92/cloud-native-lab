// Kafka producer: order-lifecycle event log. Config comes entirely from env
// vars fed by External Secrets in gitops/ — never hardcoded here. Same
// pattern as db.js/redis.js/rabbitmq.js.
//
// Kafka here is an IMMUTABLE EVENT LOG (docs/vision.md: "Kafka | Immutable
// event log: order lifecycle events for many consumers"), distinct from
// RabbitMQ's task-queue role (./rabbitmq.js). A fact is appended once and
// can be replayed by any number of independent consumers (Airflow, Phase 7)
// — this module owns that concern only, kept deliberately separate from
// rabbitmq.js per docs/architecture.md: "do not blur them".
//
// Client: @confluentinc/kafka-javascript — the official, actively
// maintained Kafka client for Node.js (a librdkafka wrapper with a
// KafkaJS-compatible API). kafkajs itself has had no release since
// February 2023 and is considered unmaintained; confirmed via
// https://github.com/confluentinc/confluent-kafka-javascript and its
// MIGRATION.md (fetched live in this session) for the KafkaJS-compatible
// `.KafkaJS` API shape used below (config nested under a `kafkaJS` key).
'use strict';

const { Kafka } = require('@confluentinc/kafka-javascript').KafkaJS;

// Topic name shared by convention with gitops/data/kafka/topic.yaml — no
// shared package between GitOps manifests and app code (docs/architecture.md's
// repository layout keeps apps/ per-service), so the name is duplicated by
// design, same as ORDER_CREATED_QUEUE in ./rabbitmq.js.
const ORDER_EVENTS_TOPIC = 'order-events';

function buildKafkaClient() {
  const host = process.env.KAFKA_HOST;
  const port = process.env.KAFKA_PORT || 9092;
  return new Kafka({
    kafkaJS: {
      clientId: 'backend',
      brokers: [`${host}:${port}`],
      // ssl: false — matches gitops/data/kafka/cluster.yaml's listener
      // (tls: false); SASL/SCRAM-SHA-512 still protects the password (it is
      // never sent in the clear, per Strimzi's own docs), consistent with
      // every other in-cluster service in this lab trusting the cluster
      // network boundary instead of adding TLS.
      ssl: false,
      sasl: {
        mechanism: 'scram-sha-512',
        username: process.env.KAFKA_USERNAME,
        password: process.env.KAFKA_PASSWORD,
      },
    },
  });
}

// Connects a single Producer, reused for every publish for the life of the
// process — same "one client per logical unit of work" reasoning as
// ./rabbitmq.js's single Channel.
async function createKafkaProducer() {
  const kafka = buildKafkaClient();
  // acks: 1 (producer-level per the client's KafkaJS-compat config, not
  // per-send — see MIGRATION.md) — leader-only acknowledgement is
  // sufficient for a lab event log with one broker (no in-sync replica set
  // to wait on beyond the leader itself; gitops/data/kafka/cluster.yaml
  // has default.replication.factor: 1).
  const producer = kafka.producer({ kafkaJS: { acks: 1 } });
  await producer.connect();
  return producer;
}

// Publishes an order-lifecycle event. Keyed by order id so that, should the
// topic ever gain more partitions, every event for one order still lands on
// the same partition (preserving per-order ordering for consumers).
function publishOrderCreated(producer, order) {
  const value = JSON.stringify({ type: 'order.created', order });
  return producer.send({
    topic: ORDER_EVENTS_TOPIC,
    messages: [{ key: String(order.id), value }],
  });
}

module.exports = { createKafkaProducer, publishOrderCreated, ORDER_EVENTS_TOPIC };
