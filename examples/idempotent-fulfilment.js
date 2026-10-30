/**
 * Illustration: one fulfilment function, safe to call from three places.
 *
 * Written for this case study, not copied from the product. It shows the
 * pattern: /verify, the payment webhook and a reconciler cron can all confirm
 * the same payment, in any order, any number of times. Only the first caller
 * claims it, and only that caller has side effects.
 */

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} orderId  Razorpay order id; the purchase doc is keyed by it
 * @param {{ paymentId: string, via: "verify" | "webhook" | "reconcile" }} confirmation
 * @param {{ sendWelcome: Function, recordPayment: Function }} effects
 */
async function fulfillPurchase(db, orderId, { paymentId, via }, effects) {
  const ref = db.collection("purchases").doc(orderId);

  // The claim. Firestore re-runs this callback if the doc changes between the
  // read and the write, so two callers racing can't both see "not paid".
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`Unknown order ${orderId}`);
    if (snap.data().status === "paid") return false;

    tx.update(ref, {
      status: "paid",
      paymentId,
      fulfilledBy: via,
      paidAt: new Date(),
    });
    return true;
  });

  // Someone else got here first: same answer, no second email.
  if (!claimed) return { status: "already" };

  // Side effects run once, outside the transaction, so a retry of the
  // transaction can never send them twice.
  const purchase = (await ref.get()).data();
  await effects.recordPayment(purchase);
  await effects.sendWelcome(purchase); // enqueued, not sent inline

  return { status: "fulfilled" };
}

module.exports = { fulfillPurchase };
